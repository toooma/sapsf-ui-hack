// ==UserScript==
// @name         SAP SuccessFactors UI Hack
// @namespace    https://github.com/toooma/sapsf-ui-hack
// @version      1.7.2
// @description  Enhances SAP SuccessFactors UI.
// @match        https://hcm55.sapsf.eu/*
// @match        https://hcm55preview.sapsf.eu/*
// @run-at       document-end
// @icon         https://img.icons8.com/ios-filled/100/circled-s.png
// @grant        none
// @updateURL    https://raw.githubusercontent.com/toooma/sapsf-ui-hack/main/sapsf-ui-hack.user.js
// @downloadURL  https://raw.githubusercontent.com/toooma/sapsf-ui-hack/main/sapsf-ui-hack.user.js
// ==/UserScript==

(() => {
  "use strict";

  /**************************************************************************
   * SAP SuccessFactors UI Hack
   *
   * Structure:
   * 1. Global constants / utilities
   * 2. Global features, running on every page
   * 3. Route-based feature registry
   * 4. Fetch target registry
   * 5. Route-specific modules
   * 6. Bootstrap
   **************************************************************************/

  if (window.__sapSfUiHackLoaded) {
    console.warn("⚠️ SAP SuccessFactors UI Hack already loaded; skipping second install.");
    return;
  }
  window.__sapSfUiHackLoaded = true;
  console.log("🔍 SAP SuccessFactors UI Hack userscript starting...");

  /**************************************************************************
   * 1. Global constants / utilities
   **************************************************************************/

  const originalFetch = window.fetch.bind(window);

  const ROUTES = {
    LIVE_PROFILE: "/sf/liveprofile",
    LIVE_PROFILE_INTENT: "/sf/intent/LiveProfile-display",
    DOCUMENT_GENERATOR: "/xi/ui/documentgeneration/pages/generator.xhtml",
    POSITION: "/xi/ui/ect/pages/positionMgmt/position.xhtml",
    MANAGE_DATA: "/xi/ui/genericobject/pages/mdf/mdf.xhtml",
    MY_WORKFLOW_REQUESTS: "/sf/myWorkflowRequests",
    WORKFLOW_TODOS: "/xi/ui/peopleprofile/pages/workflow/todos.xhtml",
    WORKFLOW_APPROVAL: "/xi/ui/ect/pages/workflowApproval/ectWorkflowApproval.xhtml",
    WORKFLOW_APPROVAL_LINK: "/sf/hrisworkflowapprovelink",
  };

  function getCurrentPathname() {
    return window.location.pathname;
  }

  function isRoute(pathname) {
    return getCurrentPathname() === pathname;
  }

  function routeMatches(pathnameOrMatcher) {
    if (typeof pathnameOrMatcher === "string") {
      return isRoute(pathnameOrMatcher);
    }

    if (typeof pathnameOrMatcher === "function") {
      return Boolean(pathnameOrMatcher(window.location));
    }

    return false;
  }

  function safeRun(label, fn) {
    try {
      return fn();
    } catch (err) {
      console.error(`❌ ${label} failed:`, err);
      return undefined;
    }
  }

  async function safeRunAsync(label, fn) {
    try {
      return await fn();
    } catch (err) {
      console.error(`❌ ${label} failed:`, err);
      return undefined;
    }
  }

  function toQueryString(params) {
    return params.toString().replace(/\+/g, "%20");
  }

  async function fetchJson(url, options = {}) {
    const res = await originalFetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "include",
      ...options
    });

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!res.ok) {
      const errorBody = isJson
        ? await res.json().catch(() => null)
        : await res.text().catch(() => "");

      throw new Error(
        `Request failed: ${res.status} ${res.statusText} ${url}\n${JSON.stringify(errorBody, null, 2)}`
      );
    }

    return isJson ? res.json() : res.text();
  }

  function getFetchUrl(args) {
    const input = args?.[0];
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input?.url || "";
  }

  const isAfterToday = dateStr => new Date(dateStr) > new Date(new Date().toDateString());
  const today = new Date().toLocaleDateString('en-CA');

  function juicSetValue(input, value, key = value[0] || '') {
    const el = typeof input === 'string' ? document.querySelector(input) : input;
    if (!el) return false;

    const fireFromAttr = (attr, fallbackEvent) => {
      const code = el.getAttribute(attr);
      const match = code && code.match(/juic\.fire\(["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
      if (!match) return;

      juic.fire(match[1], match[2], fallbackEvent);
    };

    const event = type => ({
      type,
      key,
      keyCode: key.charCodeAt(0),
      which: key.charCodeAt(0),
      target: el,
      currentTarget: el,
      preventDefault() {},
      stopPropagation() {}
    });

    el.focus();
    el.value = value;

    fireFromAttr('onfocus', {
      type: 'focus',
      target: el,
      currentTarget: el
    });

    fireFromAttr('onkeydown', event('keydown'));
    fireFromAttr('onkeyup', event('keyup'));

    return true;
  }

  function memoizeAsync(cache, key, factory) {
    if (!cache.has(key)) {
      const promise = Promise.resolve()
        .then(factory)
        .catch(err => {
          cache.delete(key); // allow a retry after failure
          throw err;
        });
      cache.set(key, promise);
    }
    return cache.get(key);
  }

  let currentFeatureScope = null;

  function newObserver(callback) {
    const observer = new MutationObserver(callback);
    currentFeatureScope?.observers.push(observer);
    return observer;
  }

  const activeFeatures = new Map();

  const escapeODataString = value => String(value).replace(/'/g, "''");

  const incumbentUserIdCache = new Map();
  function fetchIncumbentUserId(positionCode, effectiveDate) {
    if (!positionCode) return Promise.resolve(null);
    const asOf = effectiveDate || today;
    return memoizeAsync(incumbentUserIdCache, `${positionCode}|${asOf}`, async () => {
      const params = new URLSearchParams({
        "$format": "json",
        "$filter":
          `position eq '${escapeODataString(positionCode)}'` +
          ` and (employmentNav/endDate eq null or employmentNav/endDate ge '${asOf}')`,
        "$select": "userId",
        "fromDate": asOf
      });
      const data = await fetchJson(`/odata/v2/restricted/EmpJob?${toQueryString(params)}`);
      return data?.d?.results?.[0]?.userId || null;
    });
  }

  const displayNameCache = new Map();
  function fetchUserDisplayName(userId) {
    if (!userId) return Promise.resolve(null);
    return memoizeAsync(displayNameCache, userId, async () => {
      const data = await fetchJson(
        `/odata/v2/restricted/User(%27${encodeURIComponent(userId)}%27)?%24format=json&%24select=displayName`
      );
      return data?.d?.displayName || null;
    });
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  /**************************************************************************
   * 2. Global features, running on every page
   **************************************************************************/

  function applyStyleHacks() {
    const style = document.createElement("style");

    style.textContent = `
      .ectTextArea {
        resize: both !important;
      }

      #selectedEmployment ui5-text,
      #selectedEmployment ui5-text * {
        user-select: text !important;
        -webkit-user-select: text !important;
        cursor: text !important;
      }

      .ui5Custom {
        display: block;
        font-size: 0.8rem;
        opacity: 1;
        text-align: start;
      }

      div[class*="EmploymentListItem_container__"] {
        position: relative;
        min-height: 1rem;
      }
      div[class*="EmploymentListItem_displayTitleContainer__"] {
        position: absolute;
        right: 0;
      }

      div[class*="FullProfileDetailView_contentWrapper__"] > ui5-text:not(.ui5Custom),
      div[class*="EmploymentListItem_displayTitleContainer__"] > ui5-text:not(.ui5Custom),
      div[class*="EmploymentListItem_container__"] > ui5-text:not(.ui5Custom) {
        display: none !important;
      }

      div[class*="HeaderFieldsDisplay_container__"] {
        display: none !important;
      }

      table.dataGridLayout [style*="visibility: hidden"],
      table.dataGridLayout [style*="visibility:hidden"] {
        display: none !important;
      }
      table .emptyActionItem {
        display: none !important;
      }

      xweb-px-survey-invitation-dialog {
        display: none !important;
      }

    `;

    document.documentElement.appendChild(style);

    console.log("✅ Style hacks applied.");
  }

  function startKeepSessionAliveWhenAvailable() {
    const checkIntervalMs = 1000;
    const keepAliveIntervalMs = 55000;
    const maxWaitAttempts = 60; // give up after about one minute

    const isAvailable = () =>
      typeof window.SFSessionTimeout !== "undefined" &&
      typeof window.SFSessionTimeout.extendSession === "function";

    const extendSessionSafely = () => {
      try {
        if (!isAvailable()) return;
        console.log("Extending SAPSF session...");
        window.SFSessionTimeout.extendSession();
      } catch (err) {
        console.error("Failed to extend SAPSF session:", err);
      }
    };

    let attempts = 0;
    const waitTimer = setInterval(() => {
      attempts++;
      if (isAvailable()) {
        clearInterval(waitTimer);
        console.log("✅ SFSessionTimeout.extendSession is available. Starting keep-alive.");
        extendSessionSafely();
        setInterval(extendSessionSafely, keepAliveIntervalMs);
      } else if (attempts >= maxWaitAttempts) {
        clearInterval(waitTimer);
        console.warn("⚠️ SFSessionTimeout not found; keep-alive not started.");
      }
    }, checkIntervalMs);
  }

  /**************************************************************************
   * 3. Route-based feature registry
   **************************************************************************/

  const routeFeatures = [
    {
      id: "liveProfileEnrichment",
      route: location =>
        [
          ROUTES.LIVE_PROFILE,
          ROUTES.LIVE_PROFILE_INTENT
        ].includes(location.pathname),
      init: initLiveProfileEnrichment
    },
    {
      id: "documentGeneratorUserPrefill",
      route: ROUTES.DOCUMENT_GENERATOR,
      init: initDocumentGeneratorUserPrefill
    },
    {
      id: "positionPendingWorkflowLink",
      route: location =>
        [ROUTES.POSITION, ROUTES.MANAGE_DATA].includes(location.pathname) &&
        location.hash.includes("t=Position"),
      init: initPositionPendingWorkflowLink
    },
    {
      id: "positionIncumbentLink",
      route: location =>
        [ROUTES.POSITION, ROUTES.MANAGE_DATA].includes(location.pathname) &&
        location.hash.includes("t=Position"),
      init: initPositionIncumbentLink
    },
    {
      id: "myWorkflowRequestEnrichment",
      route: location =>
        [
          ROUTES.MY_WORKFLOW_REQUESTS,
          ROUTES.WORKFLOW_TODOS
        ].includes(location.pathname),
      init: initMyWorkflowRequestEnrichment
    },
    {
      id: "workflowApprovalExport",
      route: location =>
        [
          ROUTES.WORKFLOW_APPROVAL,
          ROUTES.WORKFLOW_APPROVAL_LINK
        ].includes(location.pathname),
      init: initWorkflowApprovalExport
    },

    /*
     * Add future route-based features here:
     *
     * {
     *   id: "someFutureRouteFeature",
     *   route: "/sf/someRoute",
     *   init: initSomeFutureRouteFeature
     * }
     *
     * You may also use a route matcher function:
     *
     * {
     *   id: "someDynamicRouteFeature",
     *   route: location => location.pathname.startsWith("/sf/somePrefix"),
     *   init: initSomeDynamicRouteFeature
     * }
     */
  ];

  function runMatchingRouteFeatures() {
    for (const feature of routeFeatures) {
      const matches = routeMatches(feature.route);
      const scope = activeFeatures.get(feature.id);

      if (matches && !scope) {
        const newScope = { observers: [] };
        activeFeatures.set(feature.id, newScope);
        currentFeatureScope = newScope;
        try {
          safeRun(`Route feature "${feature.id}"`, feature.init);
        } finally {
          currentFeatureScope = null;
        }
      } else if (!matches && scope) {
        scope.observers.forEach(o => o.disconnect());
        activeFeatures.delete(feature.id);
        console.log(`🧹 Route feature "${feature.id}" torn down.`);
      }
    }
  }

  function watchRouteChanges() {
    let lastUrl = window.location.href;

    function checkRoute() {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      window.sapSfUiHackLiveProfileEnrichment?.refresh();
      safeRun("runMatchingRouteFeatures", runMatchingRouteFeatures);
    }

    for (const method of ["pushState", "replaceState"]) {
      const original = window.history[method];
      window.history[method] = function (...args) {
        const result = original.apply(this, args);
        checkRoute();
        return result;
      };
    }

    window.addEventListener("popstate", checkRoute);
    window.addEventListener("hashchange", checkRoute);
  }

  /**************************************************************************
   * 4. Fetch target registry
   **************************************************************************/

  const fetchTargets = [
    {
      id: "liveProfileWorkforcePersonProfile",
      route: location =>
        [
          ROUTES.LIVE_PROFILE,
          ROUTES.LIVE_PROFILE_INTENT
        ].includes(location.pathname),
      urlPattern: /\/rest\/workforce\/v1\/workforcePersonProfiles\//,
      handle: handleLiveProfileWorkforcePersonProfileFetch
    },
    {
      id: "liveProfileCostAssignment",
      route: location =>
        [
          ROUTES.LIVE_PROFILE,
          ROUTES.LIVE_PROFILE_INTENT
        ].includes(location.pathname),
      urlPattern: /\/rest\/workforce\/assignment\/additionalinfo\/uiconfig\/v1\/configs\/costAssignment\b/,
      handle: handleLiveProfileCostAssignmentFetch
    },

    /*
     * Add future fetch target handlers here:
     *
     * {
     *   id: "someFutureFetchTarget",
     *   route: "/sf/someRoute",
     *   urlPattern: /\\/rest\\/some\\/api\\//,
     *   handle: handleSomeFutureFetchTarget
     * }
     *
     * You may also use a route matcher function:
     *
     * {
     *   id: "someDynamicRouteFetchTarget",
     *   route: location => location.pathname.startsWith("/sf/somePrefix"),
     *   urlPattern: /\\/rest\\/some\\/api\\//,
     *   handle: handleSomeDynamicRouteFetchTarget
     * }
     */
  ];

  function installFetchWatcher() {
    window.fetch = async function (...args) {
      const response = await originalFetch(...args);

      try {
        const url = getFetchUrl(args);
        if (!url) return response;

        for (const target of fetchTargets) {
          if (!routeMatches(target.route)) {
            continue;
          }

          if (!target.urlPattern.test(url)) {
            continue;
          }

          safeRun(`Fetch target "${target.id}"`, () => {
            target.handle({
              url,
              args,
              response
            });
          });
        }
      } catch (err) {
        console.error("Fetch watcher error:", err);
      }

      return response;
    };

    console.log("✅ Fetch watcher installed.");
  }

  /**************************************************************************
   * 5. Route-specific modules
   **************************************************************************/

  function initLiveProfileEnrichment() {
    const ENRICHED_ATTR = "data-work-profile-enriched";
    const SELECTED_ENRICHED_ATTR = "data-selected-work-profile-enriched-id";

    const profileDetailsCache = new Map();

    let profileEnrichScheduled = false;

    window.sapSfUiHackLiveProfileEnrichment = {
      getWorkforcePersonProfileDetails,
      enrichWorkProfiles,
      setLatestWorkProfiles,
      refresh() {
        scheduleProfileEnrichment();
      },
    };

    async function getWorkforcePersonProfileDetails(id) {
      if (profileDetailsCache.has(id)) {
        return profileDetailsCache.get(id);
      }
      const promise = fetchJson(
        `/rest/workforce/v1/workforcePersonProfiles/${id}?$expand=workProfiles($select=id,displayTitle,legacyId,displayName,departmentName,departmentId,locationName,locationId,isPrimary,assignmentTag,isActive,workerType,timeZone,hireDate,serviceDate,companyExitDate,custom02,custom05,hrManagerId)&$select=id,personId,displayName,internalId,externalId,email,dateOfBirth`
      );
      profileDetailsCache.set(id, promise);
      try {
        return await promise;
      } catch (err) {
        profileDetailsCache.delete(id);
        throw err;
      }
    }

    function findSelectedEmployment() {
      return (
        document.querySelector("#selectedEmployment") ||
        document.querySelector(
          'ui5-list[data-testid="contextSwitcherList"] ui5-li-custom[selected]'
        )
      );
    }

    function createUi5Text(label, value) {
      if (!value) return null;
      const el = document.createElement("ui5-text");
      el.classList.add("ui5Custom");
      if (label === "Position") {
        const link = createPositionLink(value);
        el.append(link || value);
        return el;
      }
      if (Array.isArray(value)) {
        for (const part of value) {
          if (part == null || part === "") continue;
          el.append(part);
        }
        return el;
      }
      el.append(value);
      return el;
    }

    function findEmploymentContainer(li) {
      return li.querySelector(
        'div[class^="EmploymentListItem_container__"], div[class*=" EmploymentListItem_container__"]'
      );
    }

    function findFullProfileDetailContainer() {
      return document.querySelector(
        'div[class^="FullProfileDetailView_contentWrapper__"], div[class*=" FullProfileDetailView_contentWrapper__"]'
      );
    }

    function findUserDisplayNameContainers() {
      return [
        ...document.querySelectorAll(
          'div[class^="UserDisplayName_root__"], div[class*=" UserDisplayName_root__"]'
        )
      ];
    }

    function extractBracketCode(value) {
      return value?.match(/\(([^)]+)\)/)?.[1] || null;
    }

    function createPositionLink(value) {
      const code = extractBracketCode(value);
      if (!code) return null;

      const a = document.createElement("a");
      a.href = `/xi/ui/ect/pages/positionMgmt/position.xhtml?m=PositionManagement&#t=Position&e=${encodeURIComponent(code)}`;
      a.textContent = value;
      a.style.color = "inherit";
      a.style.textDecoration = "underline";
      a.style.setProperty("cursor", "pointer", "important");

      return a;
    }

    function createDocumentGenerationLink(userId) {
      if (!userId) return null;

      const a = document.createElement("a");
      a.href = `/xi/ui/documentgeneration/pages/generator.xhtml?userId=${encodeURIComponent(userId)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "📜";
      a.title = `Generate document for ${userId}`;
      a.style.color = "inherit";
      a.style.textDecoration = "none";
      a.style.marginLeft = "0.35rem";
      a.style.setProperty("cursor", "pointer", "important");

      return a;
    }

    function buildProfileRows(profile) {
      const idParts = [];

      if (profile?.personIdExternal) {
        idParts.push(`PersonId: ${profile.personIdExternal}`);
      }

      if (profile?.legacyId) {
        if (idParts.length) {
          idParts.push(" ");
        }

        idParts.push(`UserId: ${profile.legacyId}`);

        const docGenLink = createDocumentGenerationLink(profile.legacyId);
        if (docGenLink) {
          idParts.push(" ");
          idParts.push(docGenLink);
        }
      }

      return [
        [
          "Dates",
          [
            profile?.hireDate
              ? `${isAfterToday(profile?.hireDate) ? "🟡 Future Hire" : profile.isActive ? "🟢 Hire" : "⚫ Hire"}: ${profile.hireDate}`
              : null,
            profile?.companyExitDate ? `🔴 Exit: ${profile.companyExitDate}` : null
          ]
            .filter(Boolean)
            .join(" ")
        ],
        ["Position", profile.custom02],
        ["Unit", profile.departmentName],
        ["Entity", profile.custom05],
        ["Ids", idParts.length ? idParts : null]
      ];
    }

    function clearCustomProfileRows(container) {
      container
        ?.querySelectorAll(":scope > ui5-text.ui5Custom")
        ?.forEach(el => el.remove());
    }

    function hasCustomRows(container) {
      return Boolean(container?.querySelector(":scope > ui5-text.ui5Custom"));
    }

    function renderProfileRows(container, profile) {
      if (!container || !profile) return false;
      clearCustomProfileRows(container);
      for (const [label, value] of buildProfileRows(profile)) {
        const textEl = createUi5Text(label, value);
        if (textEl) container.appendChild(textEl);
      }
      // Guarantees at least one custom row, so a profile with no visible
      // values does not look "unrendered" and re-render on every pass.
      if (!hasCustomRows(container)) {
        const placeholder = document.createElement("ui5-text");
        placeholder.classList.add("ui5Custom");
        container.appendChild(placeholder);
      }
      return true;
    }

    function enrichWorkProfileItem(profile) {
      if (!profile?.id) return false;
      const escapedId = CSS.escape(String(profile.id));
      const li = document.querySelector(
        `ui5-li-custom-xweb-people-profile[id="${escapedId}"], ` +
        `ui5-li-custom[id="${escapedId}"]`
      );
      if (!li) return false;

      const container = findEmploymentContainer(li);
      if (!container) return false;

      if (
        li.getAttribute(ENRICHED_ATTR) === String(profile.id) &&
        hasCustomRows(container)
      ) {
        return true;
      }

      renderProfileRows(container, profile);
      li.setAttribute(ENRICHED_ATTR, String(profile.id));

      const orderIndex = latestWorkProfiles.findIndex(p => p.id === profile.id);
      if (orderIndex >= 0) li.style.order = String(orderIndex);

      return true;
    }

    function getSelectedWorkProfileIdFromHash() {
      const match = window.location.hash.match(/\/(?:profile|detail\/view)\/([^/?&]+)/);
      return match?.[1] || null;
    }

    function findSelectedProfile(workProfiles) {
      const sameId = (a, b) =>
        Boolean(a) && Boolean(b) && String(a).toUpperCase() === String(b).toUpperCase();

      const hashId = getSelectedWorkProfileIdFromHash();
      const byHash = hashId && workProfiles.find(p => sameId(p?.id, hashId));
      if (byHash) return byHash;

      const popoverId = document
        .querySelector("ui5-popover[initial-focus]")
        ?.getAttribute("initial-focus");
      const byPopover = popoverId && workProfiles.find(p => sameId(p?.id, popoverId));
      if (byPopover) return byPopover;

      return workProfiles.length === 1 ? workProfiles[0] : null;
    }

    function enrichSelectedEmployment(workProfiles = []) {
      const profile = findSelectedProfile(workProfiles);
      if (!profile) return false;
      const selectedEmployment = findSelectedEmployment();

      const fullProfileContainer = findFullProfileDetailContainer();
      if (!selectedEmployment && !fullProfileContainer) return false;

      const markerEl = selectedEmployment || fullProfileContainer;
      const container = selectedEmployment
        ? findEmploymentContainer(selectedEmployment)
        : fullProfileContainer;
      if (!container) return false;

      if (
        markerEl.getAttribute(SELECTED_ENRICHED_ATTR) === String(profile.id) &&
        hasCustomRows(container)
      ) {
        return true;
      }

      renderProfileRows(container, profile);
      markerEl.setAttribute(SELECTED_ENRICHED_ATTR, String(profile.id));
      return true;
    }

    function applyProfileEnrichment() {
      if (!latestWorkProfiles.length) return;
      for (const profile of latestWorkProfiles) {
        enrichWorkProfileItem(profile);
      }
      enrichSelectedEmployment(latestWorkProfiles);
    }

    function scheduleProfileEnrichment() {
      if (profileEnrichScheduled) return;
      profileEnrichScheduled = true;
      requestAnimationFrame(() => {
        profileEnrichScheduled = false;
        safeRun("Profile enrichment", applyProfileEnrichment);
      });
    }

    function enrichWorkProfiles() {
      // Kept for existing callers. The persistent observer does the real work.
      scheduleProfileEnrichment();
    }

    function setLatestWorkProfiles(workProfiles = []) {
      latestWorkProfiles = workProfiles;
      scheduleProfileEnrichment();
    }

    const profileObserver = newObserver(() => scheduleProfileEnrichment());
    profileObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    scheduleProfileEnrichment();

    ensureCostAssignmentObserver();
    scheduleCostAssignmentEnrichment();
    console.log("✅ Live Profile enrichment module initialized.");
  }

  let liveProfileEnrichmentRunId = 0;

  function handleLiveProfileWorkforcePersonProfileFetch({ response }) {
    const liveProfileEnrichment = window.sapSfUiHackLiveProfileEnrichment;

    if (!liveProfileEnrichment) {
      console.warn("⚠️ Live Profile enrichment module is not initialized.");
      return;
    }

    const runId = ++liveProfileEnrichmentRunId;

    response
      .clone()
      .json()
      .then(async data => {
        const id = data?.id;
        if (!id) return;

        // Clear only when the person really changes, so a re-render or a
        // failed request never blanks the panel for the same person.
        if (id !== latestPersonId) {
          latestPersonId = id;
          liveProfileEnrichment.setLatestWorkProfiles([]);
        }

        try {
          const workforcePersonProfile =
            await liveProfileEnrichment.getWorkforcePersonProfileDetails(id);

          if (runId !== liveProfileEnrichmentRunId) return; // stale result

          workforcePersonProfile.workProfiles = (workforcePersonProfile.workProfiles ?? [])
            .sort((a, b) =>
              (b.hireDate ?? "").localeCompare(a.hireDate ?? "") ||
              Number(Boolean(b.isActive)) - Number(Boolean(a.isActive))
            );

          for (const wp of workforcePersonProfile.workProfiles ?? []) {
            wp.personIdExternal = workforcePersonProfile?.externalId;
          }

          liveProfileEnrichment.setLatestWorkProfiles(
            workforcePersonProfile?.workProfiles || []
          );
        } catch (err) {
          console.error("Failed to fetch workforcePersonProfile details:", err);
        }
      })
      .catch(err => {
        console.error("Failed to parse WorkProfile response JSON:", err);
      });
  }

  let latestPersonId = null;
  let latestWorkProfiles = [];
  let latestCostAssignmentItems = [];
  let costAssignmentObserver = null;
  let costAssignmentScheduled = false;
  const COST_ASSIGNMENT_ENRICHED_ATTR = "data-sapsf-ui-hack-cost-assignment-enriched";

  function isLiveProfileRoute() {
    return [ROUTES.LIVE_PROFILE, ROUTES.LIVE_PROFILE_INTENT].includes(window.location.pathname);
  }

  function handleLiveProfileCostAssignmentFetch({ response }) {
    response
      .clone()
      .json()
      .then(data => {
        const items = data?.$data?.timeslices?.[0]?.items || [];
        setLatestCostAssignmentItems(items);
      })
      .catch(err => {
        console.error("Failed to parse Cost Assignment response JSON:", err);
      });
  }

  function setLatestCostAssignmentItems(items) {
    // Always replace, including with an empty list, so a previous person's
    // percentages are never applied to the next person's cards.
    latestCostAssignmentItems = items
      .map(item => ({
        percentage: item?.percentage,
        code: item?.workBreakdownStructureDetail?.code
      }))
      .filter(item => item.code && item.percentage !== null && item.percentage !== undefined);

    ensureCostAssignmentObserver();
    scheduleCostAssignmentEnrichment();
  }

  function ensureCostAssignmentObserver() {
    if (costAssignmentObserver) return;

    costAssignmentObserver = new MutationObserver(() => {
      scheduleCostAssignmentEnrichment();
    });

    costAssignmentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title", "aria-label"]
    });
  }

  function stopCostAssignmentObserver() {
    costAssignmentObserver?.disconnect();
    costAssignmentObserver = null;
  }

  function scheduleCostAssignmentEnrichment() {
    if (costAssignmentScheduled) return;
    costAssignmentScheduled = true;

    requestAnimationFrame(() => {
      costAssignmentScheduled = false;

      if (!isLiveProfileRoute()) {
        stopCostAssignmentObserver();
        return;
      }

      safeRun("Cost assignment enrichment", applyCostAssignmentEnrichment);
    });
  }

  function findAdditionalAssignmentCards() {
    return [...document.querySelectorAll('ui5-text[title="Additional Assignment"]')]
      .map(titleEl =>
        titleEl.closest(
          'div[class^="ListCard_itemContent__"], div[class*=" ListCard_itemContent__"]'
        )
      )
      .filter(Boolean);
  }

  function findPercentageEl(card, percentage) {
    const percentageText = `${percentage}%`;
    return [...card.querySelectorAll("ui5-text")].find(el =>
      el.getAttribute(COST_ASSIGNMENT_ENRICHED_ATTR) === percentageText ||
      el.getAttribute("title") === percentageText ||
      el.getAttribute("aria-label") === percentageText ||
      el.textContent.trim() === percentageText
    );
  }

  function appendCode(percentageEl, percentage, code) {
    if (!percentageEl) return false;

    const bdi = percentageEl.querySelector("bdi") || percentageEl;
    const currentText = bdi.textContent.trim();

    // The text is the source of truth. A reused DOM node with a stale marker
    // but no code in its text still gets the code appended.
    if (!currentText.includes(code)) {
      const label = `${currentText} · ${code}`;
      bdi.textContent = label;
      percentageEl.setAttribute("title", label);
      percentageEl.setAttribute("aria-label", label);
    }

    percentageEl.setAttribute(COST_ASSIGNMENT_ENRICHED_ATTR, `${percentage}%`);
    return true;
  }

  function applyCostAssignmentEnrichment() {
    if (!latestCostAssignmentItems.length) return true;

    const cards = findAdditionalAssignmentCards();
    if (!cards.length) return false;

    let enrichedCount = 0;

    for (const item of latestCostAssignmentItems) {
      const card = cards.find(candidate => findPercentageEl(candidate, item.percentage));
      const percentageEl = card && findPercentageEl(card, item.percentage);

      if (appendCode(percentageEl, item.percentage, item.code)) {
        enrichedCount++;
      }
    }

    return enrichedCount === latestCostAssignmentItems.length;
  }

  function initDocumentGeneratorUserPrefill() {
    const userId = new URLSearchParams(window.location.search).get("userId");
    if (!userId) return;

    const userSelector = 'input[aria-label="User"]';
    const checkboxSelector = 'input[type="checkbox"][aria-checked="false"]';
    const timeoutMs = 10000;

    function isJuicReady(input) {
      return (
        input &&
        typeof window.juic?.fire === "function" &&
        (
          input.getAttribute("onfocus")?.includes("juic.fire") ||
          input.getAttribute("onkeydown")?.includes("juic.fire") ||
          input.getAttribute("onkeyup")?.includes("juic.fire")
        )
      );
    }

    function isCheckboxReady(checkbox) {
      return (
        checkbox &&
        typeof window.juic?.fire === "function" &&
        checkbox.getAttribute("onclick")?.includes("juic.fire")
      );
    }

    let checkboxDone = false;
    let userDone = false;

    function tickCheckbox() {
      const checkbox = document.querySelector(checkboxSelector);
      if (!isCheckboxReady(checkbox)) return false;
      checkbox.click(); // the native click runs the onclick juic.fire handler
      console.log("✅ Document Generator checkbox ticked.");
      return true;
    }

    function trySetUser() {
      const input = document.querySelector(userSelector);
      if (!isJuicReady(input)) return false;
      const success = juicSetValue(input, `${userId}`);
      if (success) console.log("✅ Document Generator user prefilled:", userId);
      return success;
    }

    function tryInit() {
      if (!checkboxDone) checkboxDone = tickCheckbox();
      if (!userDone) userDone = trySetUser();
      return checkboxDone && userDone;
    }

    if (tryInit()) return;

    const observer = newObserver(() => {
      if (tryInit()) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "onclick",
        "onfocus",
        "onkeydown",
        "onkeyup",
        "aria-label",
        "aria-checked"
      ]
    });

    setTimeout(() => {
      observer.disconnect();
      if (!document.querySelector(checkboxSelector)) {
        console.warn("⚠️ Document Generator checkbox was not found or JUIC click trigger was not ready.");
      }
      if (!document.querySelector(userSelector)) {
        console.warn("⚠️ Document Generator User input was not found.");
      } else {
        console.warn("⚠️ Document Generator User input found, but JUIC triggers were not ready.");
      }
    }, timeoutMs);
  }

  function getPositionCodeFromPage() {
    const panel = document.querySelector('div.MDFViewPanel');
    const row = panel?.querySelector('tr[id$="__field_0"]');
    return row?.querySelector('td.field_value')?.innerText?.trim() || null;
  }

  function getPositionEffectiveDateFromPage() {
    const panel = document.querySelector("div.MDFViewPanel");
    const row = panel?.querySelector('tr[id$="__field_1"]');
    const rawDate = row?.querySelector("td.field_value")?.innerText?.trim();
    return toIsoDate(rawDate);
  }

  function toIsoDate(dateStr) {
    if (!dateStr) return null;

    const value = dateStr.trim();

    // Prefer dd/mm/yyyy only when "/" separators are used.
    const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
      const [, dd, mm, yyyy] = dmy;
      const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));

      // Validate real calendar date.
      if (
        date.getFullYear() === Number(yyyy) &&
        date.getMonth() === Number(mm) - 1 &&
        date.getDate() === Number(dd)
      ) {
        return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      }
    }

    // Fallback to JS parsing for other typical formats.
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function initPositionPendingWorkflowLink() {
    const timeoutMs = 10000;
    const LINK_ATTR = "data-sapsf-ui-hack-workflow-link";
    const workflowUrl =
      "/odata/v2/restricted/Position?%24format=json&%24expand=wfRequestNav&recordStatus=pending&fromDate=2020-01-01&%24select=code,wfRequestNav%2FwfRequestId";

    const pendingWorkflowsCache = new Map();
    let scheduled = false;
    let inFlightPositionCode = null;
    let successfulRenderCount = 0;

    function findPendingWorkflowAlert() {
      return [...document.querySelectorAll('div[role="alert"]')]
        .find(el => el.innerText?.toLowerCase().includes("pending workflow"));
    }

    function removeWorkflowLinks() {
      document
        .querySelectorAll(`[${LINK_ATTR}="true"]`)
        .forEach(el => el.remove());
    }

    function fetchPendingPositionWorkflows() {
      return memoizeAsync(pendingWorkflowsCache, "all", () =>
        fetchJson(workflowUrl).then(data => data?.d?.results || [])
      );
    }

    function findWorkflowRequestId(results, positionCode) {
      const position = results.find(item => item?.code === positionCode);
      return position?.wfRequestNav?.results?.[0]?.wfRequestId || null;
    }

    function findExistingWorkflowLink(positionCode) {
      return document.querySelector(
        `[${LINK_ATTR}="true"][data-position-code="${CSS.escape(positionCode)}"]`
      );
    }

    function appendWorkflowLink(alertEl, positionCode, wfRequestId) {
      if (!alertEl || !positionCode || !wfRequestId) return false;

      removeWorkflowLinks();

      const link = document.createElement("a");
      link.setAttribute(LINK_ATTR, "true");
      link.dataset.positionCode = positionCode;
      link.href = `/xi/ui/ect/pages/workflowApproval/ectWorkflowApproval.xhtml?workflowRequestId=${encodeURIComponent(wfRequestId)}`;
      link.textContent = `Open workflow #${wfRequestId}`;
      link.style.marginLeft = "0.5rem";
      link.style.textDecoration = "underline";
      link.style.fontWeight = "bold";

      alertEl.appendChild(link);

      console.log("✅ Pending workflow link appended:", positionCode, wfRequestId);

      return true;
    }

    async function enrichWorkflowLinkIfNeeded() {
      const alertEl = findPendingWorkflowAlert();
      const positionCode = getPositionCodeFromPage();

      if (!alertEl || !positionCode) return false;

      const existingLink = findExistingWorkflowLink(positionCode);
      if (existingLink && alertEl.contains(existingLink)) {
        return true;
      }

      if (inFlightPositionCode === positionCode) {
        return false;
      }

      inFlightPositionCode = positionCode;

      try {
        const results = await fetchPendingPositionWorkflows();
        const wfRequestId = findWorkflowRequestId(results, positionCode);

        if (getPositionCodeFromPage() !== positionCode) {
          return false;
        }

        if (!wfRequestId) {
          removeWorkflowLinks();
          console.warn("⚠️ Pending workflow request not found for position:", positionCode);
          return true;
        }

        const currentAlertEl = findPendingWorkflowAlert();
        if (!currentAlertEl) return false;

        const success = appendWorkflowLink(currentAlertEl, positionCode, wfRequestId);

        if (success) {
          successfulRenderCount++;
        }

        return success;
      } finally {
        if (inFlightPositionCode === positionCode) {
          inFlightPositionCode = null;
        }
      }
    }

    function scheduleEnrichment() {
      if (scheduled) return;

      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;

        safeRunAsync("positionPendingWorkflowLink refresh", async () => {
          await enrichWorkflowLinkIfNeeded();
        });
      });
    }

    const observer = newObserver(() => {
      scheduleEnrichment();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleEnrichment();

    setTimeout(() => {
      // Do not disconnect permanently. SAP changes position content without page reload.
      if (!successfulRenderCount) {
        console.warn("⚠️ Pending workflow alert not found or workflow link could not be added yet.");
      }
    }, timeoutMs);
  }

  function initPositionIncumbentLink() {
    const timeoutMs = 10000;
    const LINK_ATTR = "data-sapsf-ui-hack-incumbent-link";

    let scheduled = false;

    function findToolbar() {
      return (
        document.querySelector(".mdfConfigUiHeaderContainer")
      );
    }

    function removeIncumbentLink() {
      document
        .querySelectorAll(`[${LINK_ATTR}="true"]`)
        .forEach(el => el.remove());
    }

    function appendIncumbentLink(toolbar, positionCode, userId, displayName, asOfDate) {
      if (!toolbar || !positionCode) return false;

      removeIncumbentLink();

      const container = document.createElement("span");
      container.setAttribute(LINK_ATTR, "true");
      container.dataset.positionCode = positionCode;
      container.dataset.asOfDate = asOfDate || "";
      container.style.order = 0;
      container.style.marginLeft = "0.5rem";
      container.className = "toolbarButtonContainer btn";

      if (!userId) {
        container.textContent = "Incumbent: None";
        container.style.opacity = "0.75";
        container.style.fontSize = "0.875rem";
      } else {
        const a = document.createElement("a");
        a.href = `/sf/liveprofile?selected_user=${encodeURIComponent(userId)}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className =
          "globalIconFont1Container fd-button fd-button--compact fd-button--transparent toolbarButtonWithLabel toolbarButton";
        a.title = `Open incumbent profile`;
        a.style.textDecoration = "none";

        const outer = document.createElement("span");
        outer.className = "btn";

        const icon = document.createElement("span");
        icon.className = "icon sap-icon sap-icon--compact sap-icon--employee";
        icon.innerHTML = "&nbsp;";

        const label = document.createElement("em");
        label.className = "label link";

        const text = document.createElement("span");
        text.className = "text fd-button__text fd-button__text--compact";
        text.textContent = `Incumbent: ${displayName || userId} (${userId})`;

        label.appendChild(text);
        outer.append(icon, label);
        a.appendChild(outer);
        container.appendChild(a);
      }

      const title = toolbar.querySelector(".ectFCTitle");

      if (title) {
        title.style.order = -1;
        title.after(container);
      } else {
        toolbar.prepend(container);
      }

      console.log("✅ Incumbent link appended:", positionCode, userId, displayName);

      return true;
    }


    let inFlightPositionCode = null;
    let successfulRenderCount = 0;

    function findExistingIncumbentLink(positionCode) {
      return document.querySelector(
        `[${LINK_ATTR}="true"][data-position-code="${CSS.escape(positionCode)}"]`
      );
    }

    async function enrichIncumbentIfNeeded() {
      const positionCode = getPositionCodeFromPage();
      if (!positionCode) return false;

      const asOfDate = getPositionEffectiveDateFromPage();

      const toolbar = findToolbar();
      if (!toolbar) return false;

      // If the current DOM already has the correct enrichment, do nothing.
      // This avoids double enrichment.
      const existingLink = findExistingIncumbentLink(positionCode);
      if (existingLink && toolbar.contains(existingLink)) {
        return true;
      }

      // Avoid starting duplicate async enrichments for the same position while one is running.
      if (inFlightPositionCode === positionCode) {
        return false;
      }

      inFlightPositionCode = positionCode;

      try {
        const userId = await fetchIncumbentUserId(positionCode, asOfDate);

        // Position may have changed while async request was running.
        if (getPositionCodeFromPage() !== positionCode) {
          return false;
        }

        const displayName = await fetchUserDisplayName(userId);

        // Re-check after second async request.
        if (getPositionCodeFromPage() !== positionCode) {
          return false;
        }

        // Re-query toolbar because SAP may have replaced the DOM while we were waiting.
        const currentToolbar = findToolbar();
        if (!currentToolbar) return false;

        // If another run already enriched the current DOM, avoid duplicate append.
        const currentExistingLink = findExistingIncumbentLink(positionCode);
        if (currentExistingLink && currentToolbar.contains(currentExistingLink)) {
          return true;
        }

        removeIncumbentLink();

        const success = appendIncumbentLink(
          currentToolbar,
          positionCode,
          userId,
          displayName,
          asOfDate
        );

        if (success) {
          successfulRenderCount++;
        }

        return success;
      } finally {
        if (inFlightPositionCode === positionCode) {
          inFlightPositionCode = null;
        }
      }
    }

    function scheduleEnrichment() {
      if (scheduled) return;

      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;

        safeRunAsync("positionIncumbentLink refresh", async () => {
          await enrichIncumbentIfNeeded();
        });
      });
    }

    const observer = newObserver(() => {
      scheduleEnrichment();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleEnrichment();

    setTimeout(() => {
      // Do not disconnect permanently. SAP changes position content without page reload,
      // so this observer must keep watching.
      if (!successfulRenderCount) {
        console.warn("⚠️ Position toolbar/ incumbent link could not be added yet.");
      }
    }, timeoutMs);

    console.log("✅ Position incumbent watcher initialized.");
  }


  function initMyWorkflowRequestEnrichment() {
    const timeoutMs = 15000;
    let initialized = false;

    function install(table) {
      if (!table) return false;

      if (table.__wfRequestEnrichment) {
        table.__wfRequestEnrichment.refresh();
        return true;
      }

      const state = {
        processorByRequestId: new Map(),
        pendingIds: new Set(),
        refreshTimer: null,
        currentUserPendingRequestsPromise: null,
        workProfileNameByAssignmentUuid: new Map()
      };

      function addStyles() {
        if (document.getElementById("wfRequestEnrichmentStyle")) return;

        const style = document.createElement("style");
        style.id = "wfRequestEnrichmentStyle";
        style.textContent = `
          .wfRequestEnrichment {
            display: block;
            margin-top: 0.35rem;
            color: #526b84;
            font: 0.75rem/1.35 monospace;
            word-break: break-word;
          }

          .wfRequestEnrichment .wfProcessor {
            font-family: "72", Arial, sans-serif;
            color: #354a5f;
          }
        `;

        document.head.appendChild(style);
      }

      function getVisibleRows() {
        return table.getItems()
          .map(item => {
            const context = item.getBindingContext();
            const row = item.getDomRef();

            if (!context || !row) return null;

            const wfRequestId = String(
              context.getProperty("wfRequestNav/wfRequestUINav/wfRequestId") || ""
            );

            return wfRequestId ? { row, wfRequestId } : null;
          })
          .filter(Boolean);
      }

      function renderRows() {
        getVisibleRows().forEach(({ row, wfRequestId }) => {
          const cell = row.querySelector('td[aria-colindex="3"]');
          if (!cell) return;

          let info = cell.querySelector(".wfRequestEnrichment");
          if (!info) {
            info = document.createElement("div");
            info.className = "wfRequestEnrichment";
            cell.appendChild(info);
          }

          const processor = state.processorByRequestId.get(wfRequestId);

          info.replaceChildren();

          const idLine = document.createElement("div");
          idLine.textContent = `WfRequestId: ${wfRequestId}`;

          const processorLine = document.createElement("div");
          processorLine.className = "wfProcessor";

          if (state.pendingIds.has(wfRequestId)) {
            processorLine.textContent = "Latest by: [Loading…]";
          } else if (processor) {
            processorLine.append("Latest by: ");

            const strong = document.createElement("strong");
            strong.textContent = processor;
            processorLine.appendChild(strong);
          } else if (state.processorByRequestId.has(wfRequestId)) {
            processorLine.textContent = "Latest by: —";
          } else {
            processorLine.textContent = "Latest by: [Loading…]";
          }

          info.append(idLine, processorLine);
        });
      }

      function escapeODataString(value) {
        return String(value).replace(/'/g, "''");
      }

      async function fetchProcessorsFromWfRequestStep(ids) {
        const chunks = [];

        for (let i = 0; i < ids.length; i += 80) {
          chunks.push(ids.slice(i, i + 80));
        }

        const responses = await Promise.all(
          chunks.map(async chunk => {
            const inValues = chunk
              .map(id => `'${escapeODataString(id)}'`)
              .join(",");

            const filter =
              `wfRequestId in ${inValues}` +
              " and wfRequestNav/lastModifiedBy eq processedBy" +
              " and status eq 'COMPLETED'";

            const params = new URLSearchParams({
              "$format": "json",
              "$filter": filter,
              "$expand": "processedByNav",
              "$select": "wfRequestId,processedByNav/userId,processedByNav/displayName"
            });

            return fetchJson(
              `/odata/v2/restricted/WfRequestStep?${toQueryString(params)}`
            );
          })
        );

        const foundIds = new Set();

        responses.forEach(payload => {
          (payload?.d?.results || []).forEach(result => {
            const wfRequestId = String(result?.wfRequestId || "");
            const displayName = result?.processedByNav?.displayName || null;

            if (wfRequestId && displayName) {
              state.processorByRequestId.set(wfRequestId, displayName);
              foundIds.add(wfRequestId);
            }
          });
        });

        return foundIds;
      }

      async function fetchCurrentUserPendingRequests() {
        if (state.currentUserPendingRequestsPromise) {
          return state.currentUserPendingRequestsPromise;
        }

        state.currentUserPendingRequestsPromise = (async () => {
          const currentUserAssignmentUUID =
            window.pageHeaderJsonData?.userInfo?.assignmentUUID;

          if (!currentUserAssignmentUUID) {
            console.warn("⚠️ Current user assignmentUUID was not available.");
            return new Map();
          }

          const params = new URLSearchParams({
            "$filter":
              `(createdAssignmentId eq '${escapeODataString(currentUserAssignmentUUID)}')` +
              " and (status/code in ('PENDING'))",
            "$select": "id,lastProcessedBy"
          });

          const data = await fetchJson(
            `/rest/workforce/workflow/v1/wfRequests?${toQueryString(params)}`
          );

          return new Map(
            (data?.value || [])
              .filter(item => item?.id && item?.lastProcessedBy)
              .map(item => [String(item.id), item.lastProcessedBy])
          );
        })().catch(err => {
          console.error("❌ Could not load current user's pending workflow requests.", err);
          state.currentUserPendingRequestsPromise = null;
          return new Map();
        });

        return state.currentUserPendingRequestsPromise;
      }

      async function fetchWorkProfileNames(assignmentUuids) {
        const uncachedUuids = [
          ...new Set(assignmentUuids.filter(uuid =>
            uuid && !state.workProfileNameByAssignmentUuid.has(uuid)
          ))
        ];

        if (!uncachedUuids.length) return;

        const chunks = [];
        for (let i = 0; i < uncachedUuids.length; i += 80) {
          chunks.push(uncachedUuids.slice(i, i + 80));
        }

        await Promise.all(
          chunks.map(async chunk => {
            const filter = `(id in (${chunk
              .map(uuid => `'${escapeODataString(uuid)}'`)
              .join(",")}))`;

            const params = new URLSearchParams({
              "$select": "id,displayName",
              "$filter": filter
            });

            const data = await fetchJson(
              `/odatav4/workforce/Workforce.svc/v1/WorkProfile?${toQueryString(params)}`
            );

            // Cache misses too, so they are not requested repeatedly.
            chunk.forEach(uuid => state.workProfileNameByAssignmentUuid.set(uuid, null));

            (data?.value || []).forEach(profile => {
              if (profile?.id) {
                state.workProfileNameByAssignmentUuid.set(
                  profile.id,
                  profile.displayName || null
                );
              }
            });
          })
        );
      }

      async function fetchFallbackProcessors(idsWithoutWfRequestStepProcessor) {
        if (!idsWithoutWfRequestStepProcessor.length) return;

        const pendingRequestMap = await fetchCurrentUserPendingRequests();

        const requestIdToAssignmentUuid = idsWithoutWfRequestStepProcessor
          .map(wfRequestId => ({
            wfRequestId,
            assignmentUuid: pendingRequestMap.get(wfRequestId)
          }))
          .filter(item => item.assignmentUuid);

        if (!requestIdToAssignmentUuid.length) return;

        await fetchWorkProfileNames(
          requestIdToAssignmentUuid.map(item => item.assignmentUuid)
        );

        requestIdToAssignmentUuid.forEach(({ wfRequestId, assignmentUuid }) => {
          const displayName =
            state.workProfileNameByAssignmentUuid.get(assignmentUuid) || null;

          if (displayName) {
            state.processorByRequestId.set(wfRequestId, displayName);
          }
        });
      }

      async function fetchProcessors(ids) {
        if (!ids.length) return;

        ids.forEach(id => state.pendingIds.add(id));
        renderRows();

        try {
          const idsFoundInWfRequestStep = await fetchProcessorsFromWfRequestStep(ids);

          const idsForFallback = ids.filter(
            id => !idsFoundInWfRequestStep.has(id)
          );

          await fetchFallbackProcessors(idsForFallback);

          // Cache unresolved IDs as null.
          ids.forEach(id => {
            if (!state.processorByRequestId.has(id)) {
              state.processorByRequestId.set(id, null);
            }
          });
        } catch (err) {
          console.error("❌ Could not load workflow processor details.", err);
        } finally {
          ids.forEach(id => state.pendingIds.delete(id));
          renderRows();
        }
      }

      function refresh() {
        renderRows();

        const idsToFetch = [
          ...new Set(
            getVisibleRows()
              .map(({ wfRequestId }) => wfRequestId)
              .filter(id =>
                !state.processorByRequestId.has(id) &&
                !state.pendingIds.has(id)
              )
          )
        ];

        fetchProcessors(idsToFetch);
      }

      function scheduleRefresh() {
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(refresh, 50);
      }

      addStyles();

      table.attachUpdateFinished(scheduleRefresh);
      table.addEventDelegate({
        onAfterRendering: scheduleRefresh
      });

      table.__wfRequestEnrichment = { refresh, state };

      refresh();
      console.log("✅ WfRequestId / processed-by enrichment enabled.", table);

      return true;
    }

    function tryInitialize() {
      if (initialized) return true;

      if (typeof window.sap?.ui?.require !== "function") return false;

      window.sap.ui.require(
        ["sap/sf/workflow/todos/Global"],
        TodosGlobal => {
          try {
            const controller = TodosGlobal?.getGlobal("todosController");
            const table = controller?.getView?.().byId("todosTable");

            if (!table) return;
            initialized = install(table);
          } catch (err) {
            console.error("❌ My Workflow Requests enrichment initialization failed:", err);
          }
        }
      );

      return false;
    }

    if (tryInitialize()) return;

    const observer = newObserver(() => {
      if (tryInitialize() || initialized) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();

      if (!initialized) {
        console.warn("⚠️ My Workflow Requests table was not found.");
      }
    }, timeoutMs);
  }



  function initWorkflowApprovalExport() {
    const BUTTON_ATTR = "data-sapsf-ui-hack-workflow-export";

    let workflowApprovalExportEndpointPromise = null;
    function getWorkflowApprovalExportEndpoint() {
      if (!workflowApprovalExportEndpointPromise) {
        workflowApprovalExportEndpointPromise = fetchJson(
          "/odata/v2/cust_IntegrationConfig('workflowExport')?$format=json&$select=cust_endpointUrl"
        )
          .then(data => data?.d?.cust_endpointUrl)
          .then(endpoint => {
            if (!endpoint) {
              throw new Error(
                'Missing cust_endpointUrl for IntegrationConfig "workflowExport".'
              );
            }
            return endpoint;
          })
          .catch(err => {
            workflowApprovalExportEndpointPromise = null;
            throw err;
          });
      }
      return workflowApprovalExportEndpointPromise;
    }

    let workflowApprovalTrackerEndpointPromise = null;
    function getWorkflowApprovalTrackerEndpoint() {
      if (!workflowApprovalTrackerEndpointPromise) {
        workflowApprovalTrackerEndpointPromise = fetchJson(
          "/odata/v2/cust_IntegrationConfig('workflowExportUrl')?$format=json&$select=cust_endpointUrl"
        )
          .then(data => data?.d?.cust_endpointUrl)
          .then(endpoint => {
            if (!endpoint) {
              throw new Error(
                'Missing cust_endpointUrl for IntegrationConfig "workflowExportUrl".'
              );
            }
            return endpoint;
          })
          .catch(err => {
            workflowApprovalTrackerEndpointPromise = null;
            throw err;
          });
      }
      return workflowApprovalTrackerEndpointPromise;
    }
    async function getWorkflowApprovalTrackerLink(loggedInUser) {
      const endpoint = await getWorkflowApprovalTrackerEndpoint();
      const response = await originalFetch(endpoint, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loggedInUser)
      });
      // A missing tracker (for example HTTP 404) means no buttons are added.
      if (!response.ok) {
        console.warn(
          `Workflow tracker is unavailable: ${response.status} ${response.statusText}`
        );
        return null;
      }
      const data = await response.json().catch(() => null);
      return data?.d?.LinkingUri || null;
    }

    function text(el) {
      return el?.innerText?.replace(/\s+/g, " ").trim() || null;
    }

    function withoutTrailingCodes(value) {
      return value
        ?.replace(/(?:\s*\([^)]+\))$/, "")
        .trim() || null;
    }

    function visible(el) {
      return el && !el.closest(".struck_label, [style*='display:none'], [style*='display: none']");
    }

    function fieldValue(label) {
      const row = [...document.querySelectorAll("tr.form_field")].find(row =>
        text(row.querySelector("td.field_label .text")) === label
      );
      if (!row) return null;
      const values = [...row.querySelectorAll("td.field_value .readComp, td.field_value .read_only")]
        .filter(visible)
        .map(text)
        .filter(Boolean);
      return values[0] || null;
    }

    function parenthesizedCode(value) {
      return value?.match(/\(([^)]+)\)\s*$/)?.[1] || null;
    }

    function nameBeforeCode(value) {
      return value?.replace(/\s*\([^)]+\)\s*$/, "").trim() || null;
    }

    function normalizeDate(value) {
      if (!value) return null;
      const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        const [, day, month, year] = dmy;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
    }

    function normalizeDateTime(value) {
      if (!value) return null;
      const match = value.match(
        /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+UTC([+-])(\d{1,2}):?(\d{2})?)?/
      );
      if (!match) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
      }
      const [, day, month, year, hour, minute, second, sign, offsetHour = "0", offsetMinute = "0"] = match;
      const offsetMinutes =
        (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "-" ? -1 : 1);
      return new Date(
        Date.UTC(year, Number(month) - 1, day, hour, minute, second) - offsetMinutes * 60000
      ).toISOString();
    }

    function getChangeDateTime() {
      const row = [...document.querySelectorAll("tr.form_field")].find(row =>
        text(row.querySelector("td.field_label .text")) === "Change Date"
      );
      return normalizeDateTime(text(row?.querySelector("td.field_value")));
    }

    function getBudgetDetails() {
      const table = [...document.querySelectorAll("table.dataGridLayout")].find(table =>
        table.getAttribute("aria-label") === "Budget Code Level Salary / Fee Allocation"
      );
      return [...(table?.querySelectorAll("tbody > tr") || [])]
        .filter(row => row.cells?.[0]?.innerText?.trim() === "No")
        .map(row => text(row.cells?.[3]))
        .filter(Boolean)
        .map(value => ({
          name: nameBeforeCode(value),
          code: parenthesizedCode(value)
      }));
    }

    async function fetchBudgetSource(budgets) {
      const budgetCodes = [...new Set(
        budgets.map(budget => budget.code).filter(Boolean)
      )];
      if (!budgetCodes.length) return null;
      const params = new URLSearchParams({
        "$format": "json",
        "$select": "externalCode,cust_ceuApproverUnit",
        "$filter": `externalCode in ${budgetCodes
          .map(code => `'${String(code).replace(/'/g, "''")}'`)
          .join(",")}`
      });
      const data = await fetchJson(
        `/odata/v2/ProjectControllingObject?${toQueryString(params)}`
      );
      const groups = [...new Set(
        (data?.d?.results || [])
          .map(item => item?.cust_ceuApproverUnit?.trim())
          .filter(Boolean)
      )];
      if (!groups.length) return null;
      const prefix = groups.every(group => /^FIN\d*$/i.test(group))
        ? "Internal: "
        : "External: ";
      return prefix + groups.join(", ");
    }

    function getOtherPaymentAmounts() {
      const section = [...document.querySelectorAll(".baseLayout.ECTFormLayout")]
        .find(el =>
          text(el.querySelector(".form_title")) ===
          "Other Payments (Freelancer / Assignment)"
        );

      if (!section) return [];

      function readField(label, rowSelector) {
        const row = [...section.querySelectorAll(rowSelector)].find(row =>
          text(row.querySelector(".field_label .text")) === label
        );
        if (!row) return null;

        const value = row.querySelector(
          ".field_value .readComp:not(.struck_label .readComp), " +
          ".field_value input.formElement"
        );

        return (value?.value || text(value))?.trim() || null;
      }

      const currencyText = readField("Other Payment Currency", "tr.form_field");
      const currency = currencyText?.match(/\(([^)]+)\)\s*$/)?.[1] || null;

      const paymentTypes = [
        ["Travel", "Travel Amount"],
        ["Transfer", "Transfer Amount"],
        ["Accommodation", "Accomodation Amount"],
        ["Other", "Other Costs Amount"]
      ];

      const items = paymentTypes.flatMap(([type, label]) => {
        const amount = readField(label, ".flow_field");
        return amount ? [`${type} ${amount}`] : [];
      });

      return items.length
        ? [`${currency ? `${currency} ` : ""}${items.join(" + ")}`]
        : [];
    }

    async function scrapeWorkflowApprovalData() {
      const workflowRequestId = new URLSearchParams(window.location.search).get("workflowRequestId");
      const userInfo = window.pageHeaderJsonData?.userInfo || {};
      const budgets = getBudgetDetails();
      let budgetSource = null;
      try {
        budgetSource = await fetchBudgetSource(budgets);
      } catch (err) {
        console.warn("Could not load budget approver units:", err);
      }
      const employeeSubgroup = withoutTrailingCodes(fieldValue("Employee Subgroup"));
      const effectiveDate = normalizeDate(
        text(document.querySelector("#effectiveDate")) || fieldValue("Start Date")
      );
      const positionCode = fieldValue("Code");
      let contracteeName = fieldValue("Name of contractee");
      if (!contracteeName?.trim()) {
        try {
          const incumbentUserId = await fetchIncumbentUserId(
            positionCode,
            effectiveDate
          );
          contracteeName = await fetchUserDisplayName(incumbentUserId);
        } catch (err) {
          console.warn("Could not resolve incumbent as contractee:", err);
        }
      }

      const baseAmount = [
        parenthesizedCode(fieldValue("Currency")) || fieldValue("Currency"),
        employeeSubgroup === "Employee"
          ? fieldValue("Annual / Monthly Salary Amount")
          : fieldValue("Gross Contract Amount")
      ].filter(Boolean).join(" ") || null;

      const otherPaymentAmounts = getOtherPaymentAmounts();
      const amount = [
        baseAmount,
        ...otherPaymentAmounts
      ].filter(Boolean).join(" + ") || null;

      return {
        loggedInUser: {
          userName: userInfo.userName || null,
          id: userInfo.id || null,
          fullName: userInfo.fullName || null
        },
        WfRequest: workflowRequestId
          ? `${window.location.origin}/sf/hrisworkflowapprovelink?workflowRequestId=${encodeURIComponent(workflowRequestId)}`
          : null,
        "Effective Date": effectiveDate,
        "Change DateTime": getChangeDateTime(),
        "Changed By": fieldValue("Changed By"),
        "Location": withoutTrailingCodes(fieldValue("Location")),
        "Job Class": withoutTrailingCodes(fieldValue("Academic/Non-Academic")),
        "Full Name": contracteeName || null,
        "Dept/Unit": parenthesizedCode(fieldValue("Department")),
        "HR Partner": userInfo.fullName || null,
        "Contract Type": employeeSubgroup,
        "Entity": parenthesizedCode(fieldValue("Company")),
        "Job Title": fieldValue("Title"),
        "Position": positionCode,
        "Start Date": normalizeDate(fieldValue("Contract Start Date")),
        "End Date": normalizeDate(fieldValue("Contract End Date")),
        "Compensation": withoutTrailingCodes(fieldValue("Payment Type")),
        "Amount": amount,
        "Budget Source": budgetSource,
        "Notes": fieldValue("Description of Services")
      };
    }

    async function postWorkflowApprovalData(data) {
      const endpoint = await getWorkflowApprovalExportEndpoint();
      const response = await originalFetch(endpoint, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        throw new Error(`Workflow export failed: ${response.status} ${response.statusText}`);
      }
      return response;
    }

    function addExportButton(trackerUrl) {
      const pageTitle = document.querySelector("h1#pageTitle");

      if (!pageTitle || pageTitle.parentElement?.querySelector(`[${BUTTON_ATTR}]`)) {
        return false;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(BUTTON_ATTR, "true");
      button.className = "fd-button fd-button--compact fd-button--attention";
      button.textContent = "Export Workflow";
      button.style.marginLeft = "0.75rem";

      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Exporting…";

        try {
          await postWorkflowApprovalData(await scrapeWorkflowApprovalData());
          button.textContent = "Exported ✓";
        } catch (err) {
          console.error("Workflow export failed:", err);
          button.textContent = "Export failed";
          button.disabled = false;
        }
      });

      pageTitle.appendChild(button);
      console.log("✅ Workflow Approval export button added.");

      const trackerButton = document.createElement("button");
      trackerButton.type = "button";
      trackerButton.setAttribute("data-sapsf-ui-hack-workflow-tracker", "true");
      trackerButton.className = "fd-button fd-button--compact fd-button--transparent";
      trackerButton.textContent = "Open XLS Tracker";
      trackerButton.style.marginLeft = "0.5rem";
      trackerButton.addEventListener("click", () => {
        window.open(trackerUrl, "_blank", "noopener,noreferrer");
      });
      button.after(trackerButton);

      return true;
    }

    window.sapSfUiHackWorkflowApproval = {
      scrape: scrapeWorkflowApprovalData,
      post: async () => postWorkflowApprovalData(await scrapeWorkflowApprovalData())
    };

    let initializationStarted = false;
    let trackerUrl = null;

    async function initializeButtons() {
      if (initializationStarted) return false;
      initializationStarted = true;
      try {
        const loggedInUser = window.pageHeaderJsonData?.userInfo || {};
        trackerUrl = await getWorkflowApprovalTrackerLink({
          userName: loggedInUser.userName || null,
          id: loggedInUser.id || null,
          fullName: loggedInUser.fullName || null
        });
        if (!trackerUrl) {
          console.warn("⚠️ Workflow tracker LinkingUri was not returned; export buttons will not be added.");
          return false;
        }
        return addExportButton(trackerUrl);
      } catch (err) {
        console.error("Could not initialize workflow export buttons:", err);
        return false;
      }
    }

    const observer = newObserver(() => {
      if (!document.querySelector("h1#pageTitle")) return;
      observer.disconnect();
      initializeButtons();
    });

    if (document.querySelector("h1#pageTitle")) {
      initializeButtons();
    } else {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }  


  /**************************************************************************
   * 6. Bootstrap
   **************************************************************************/

  function bootstrap() {
    safeRun("startKeepSessionAliveWhenAvailable", startKeepSessionAliveWhenAvailable);

    safeRun("applyStyleHacks", applyStyleHacks);

    safeRun("runMatchingRouteFeatures", runMatchingRouteFeatures);
    safeRun("watchRouteChanges", watchRouteChanges);
    safeRun("installFetchWatcher", installFetchWatcher);

    console.log("✅ SAP SuccessFactors UI Hack userscript ready.");
  }

  bootstrap();

})();