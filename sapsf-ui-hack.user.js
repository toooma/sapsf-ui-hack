// ==UserScript==
// @name         SAP SuccessFactors UI Hack
// @namespace    https://github.com/toooma/sapsf-ui-hack
// @version      1.1.1
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

  console.log("🔍 SAP SuccessFactors UI Hack userscript starting...");

  /**************************************************************************
   * 1. Global constants / utilities
   **************************************************************************/

  const originalFetch = window.fetch.bind(window);

  const ROUTES = {
    LIVE_PROFILE: "/sf/liveprofile",
    DOCUMENT_GENERATOR: "/xi/ui/documentgeneration/pages/generator.xhtml",
    POSITION: "/xi/ui/ect/pages/positionMgmt/position.xhtml",
    MANAGE_DATA: "/xi/ui/genericobject/pages/mdf/mdf.xhtml",
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

  /**************************************************************************
   * 2. Global features, running on every page
   **************************************************************************/

  function applyStyleHacks() {
    const style = document.createElement("style");

    style.textContent = `
      .ectTextArea {
        resize: both !important;
      }

      #selectedEmployment ui5-text-xweb-people-profile,
      #selectedEmployment ui5-text-xweb-people-profile * {
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

      div[class*="EmploymentListItem_container__"] > ui5-text-xweb-people-profile:not(.ui5Custom),
      div[class*="FullProfileDetailView_contentWrapper__"] > ui5-text-xweb-people-profile:not(.ui5Custom) {
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

    `;

    document.documentElement.appendChild(style);

    console.log("✅ Style hacks applied.");
  }

  function startKeepSessionAliveWhenAvailable() {
    const checkIntervalMs = 1000;
    const keepAliveIntervalMs = 55000;

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

    const waitTimer = setInterval(() => {
      if (!isAvailable()) return;

      clearInterval(waitTimer);

      console.log("✅ SFSessionTimeout.extendSession is available. Starting keep-alive.");

      extendSessionSafely();
      setInterval(extendSessionSafely, keepAliveIntervalMs);
    }, checkIntervalMs);
  }

  function addGlobalSearchCommands() {
    const introOriginals = new WeakMap();

    const searchCommands = [
      {
        prefix: "u:",
        label: "User ID, using “u:”, for example “u:123456”",
        icon: "person-placeholder",
        hint: "Enter the User ID, then press Enter.",
        buildUrl: value =>
          `/sf/liveprofile?selected_user=${encodeURIComponent(value)}`
      },
      {
        prefix: "p:",
        label: "Position, using “p:”, for example “p:POS123456”",
        icon: "org-chart",
        hint: "Enter the Position code, then press Enter.",
        buildUrl: value =>
          `/xi/ui/ect/pages/positionMgmt/position.xhtml?#t=Position&m=PositionManagement&u=position&e=${encodeURIComponent(value)}`
      }
    ];

    function getSearchParts() {
      const shellbar = document.querySelector("xweb-shellbar");
      const search = shellbar?.shadowRoot?.querySelector("#search");
      const input = search?.shadowRoot?.querySelector("#inner");

      return { shellbar, search, input };
    }

    function getIntro(search) {
      return (
        search?.shadowRoot?.querySelector("xweb-global-search-intro") ||
        search?.querySelector?.("xweb-global-search-intro")
      );
    }

    function isIntroMarkupReady(intro) {
      const markup = intro?.getAttribute("markup") || "";

      return (
        markup.includes("<ul") ||
        markup.includes("</ul>") ||
        markup.includes("searchItemText")
      );
    }

    function ensureIntroEnhanced(intro) {
      if (!intro || introOriginals.has(intro)) return;

      if (!isIntroMarkupReady(intro)) {
        waitForIntroMarkupThenEnhance(intro);
        return;
      }

      enhanceIntroNow(intro);
    }

    function waitForIntroMarkupThenEnhance(intro) {
      if (!intro || intro.dataset.globalSearchCommandsIntroMarkupObserverAttached === "true") {
        return;
      }

      intro.dataset.globalSearchCommandsIntroMarkupObserverAttached = "true";

      const observer = new MutationObserver(() => {
        if (!isIntroMarkupReady(intro)) return;

        observer.disconnect();
        delete intro.dataset.globalSearchCommandsIntroMarkupObserverAttached;

        enhanceIntroNow(intro);
      });

      observer.observe(intro, {
        attributes: true,
        attributeFilter: ["markup", "no-search-result-msg"]
      });

      setTimeout(() => {
        if (!introOriginals.has(intro) && isIntroMarkupReady(intro)) {
          observer.disconnect();
          delete intro.dataset.globalSearchCommandsIntroMarkupObserverAttached;

          enhanceIntroNow(intro);
        }
      }, 500);
    }

    function enhanceIntroNow(intro) {
      if (!intro || introOriginals.has(intro)) return;

      const originalNoSearchResultMsg =
        intro.getAttribute("no-search-result-msg") ||
        "No matching results. Try a different search.";

      const originalMarkup = intro.getAttribute("markup") || "";

      introOriginals.set(intro, {
        noSearchResultMsg: originalNoSearchResultMsg,
        markup: originalMarkup
      });

      const commandOptionsMarkup = searchCommands
        .map(command => {
          const marker = `data-search-command-option="${command.prefix}"`;

          if (originalMarkup.includes(marker)) {
            return "";
          }

          return `
            <li ${marker}>
              <span class="searchItemIcon globalIconFont1Support">
                <ui5-icon-sf-header class="icon" name="${command.icon}" mode="Image"></ui5-icon-sf-header>
              </span>
              <span class="searchItemText">${command.label}</span>
            </li>
          `;
        })
        .join("");

      if (!commandOptionsMarkup.trim()) return;

      const enhancedMarkup = originalMarkup.includes("</ul>")
        ? originalMarkup.replace("</ul>", `${commandOptionsMarkup}</ul>`)
        : `${originalMarkup}${commandOptionsMarkup}`;

      intro.setAttribute("markup", enhancedMarkup);

      console.log("✅ Global search commands intro enhanced.");
    }

    function getMatchingCommand(value) {
      const normalizedValue = value.trim().toLowerCase();

      return searchCommands.find(command =>
        normalizedValue.startsWith(command.prefix.toLowerCase())
      );
    }

    function getCommandValue(value, command) {
      return value.slice(command.prefix.length).trim();
    }

    function updateCommandHint(input) {
      const value = input.value.trim();
      const command = getMatchingCommand(value);

      const { search } = getSearchParts();
      const intro = getIntro(search);
      if (!intro) return;

      ensureIntroEnhanced(intro);

      const original = introOriginals.get(intro);

      intro.setAttribute(
        "no-search-result-msg",
        command
          ? command.hint
          : original?.noSearchResultMsg || "No matching results. Try a different search."
      );
    }

    function attachGlobalSearchCommands() {
      const { input, search } = getSearchParts();
      if (!input) return false;

      const intro = getIntro(search);
      if (intro) ensureIntroEnhanced(intro);

      if (input.dataset.globalSearchCommandsAttached === "true") return true;
      input.dataset.globalSearchCommandsAttached = "true";

      input.addEventListener(
        "input",
        () => {
          updateCommandHint(input);
        },
        true
      );

      input.addEventListener(
        "keydown",
        event => {
          if (event.key !== "Enter") return;

          const value = input.value.trim();
          const command = getMatchingCommand(value);

          if (!command) return;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          const commandValue = getCommandValue(value, command);
          if (!commandValue) return;

          window.location.href = command.buildUrl(commandValue);
        },
        true
      );

      console.log("✅ Global search commands attached.");

      return true;
    }

    if (attachGlobalSearchCommands()) return;

    const observer = new MutationObserver(() => {
      if (attachGlobalSearchCommands()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }


  /**************************************************************************
   * 3. Route-based feature registry
   **************************************************************************/

  const routeFeatures = [
    {
      id: "liveProfileEnrichment",
      route: ROUTES.LIVE_PROFILE,
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
      id: "positionRecentIncumbentLink",
      route: location =>
        [ROUTES.POSITION, ROUTES.MANAGE_DATA].includes(location.pathname) &&
        location.hash.includes("t=Position"),
      init: initPositionRecentIncumbentLink
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
      if (!routeMatches(feature.route)) {
        continue;
      }

      safeRun(`Route feature "${feature.id}"`, feature.init);
    }
  }

  /**************************************************************************
   * 4. Fetch target registry
   **************************************************************************/

  const fetchTargets = [
    {
      id: "liveProfileWorkforcePersonProfile",
      route: ROUTES.LIVE_PROFILE,
      urlPattern: /\/rest\/workforce\/v1\/workforcePersonProfiles\//,
      handle: handleLiveProfileWorkforcePersonProfileFetch
    },
    {
      id: "liveProfileCostAssignment",
      route: ROUTES.LIVE_PROFILE,
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

    window.sapSfUiHackLiveProfileEnrichment = {
      getWorkforcePersonProfileDetails,
      enrichWorkProfiles
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

    function createUi5Text(label, value) {
      if (!value) return null;
      const el = document.createElement("ui5-text-xweb-people-profile");
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
        ?.querySelectorAll(":scope > ui5-text-xweb-people-profile.ui5Custom")
        ?.forEach(el => el.remove());
    }

    function renderProfileRows(container, profile) {
      if (!container || !profile) return false;
      clearCustomProfileRows(container);
      for (const [label, value] of buildProfileRows(profile)) {
        const textEl = createUi5Text(label, value);
        if (textEl) container.appendChild(textEl);
      }
      return true;
    }

    function enrichWorkProfileItem(profile) {
      if (!profile?.id) return false;
      const li = document.querySelector(
        `ui5-li-custom-xweb-people-profile[id="${CSS.escape(profile.id)}"]`
      );
      if (!li) return false;
      if (li.getAttribute(ENRICHED_ATTR) === "true") {
        return true;
      }
      const container = findEmploymentContainer(li);
      if (!container) {
        return false;
      }
      renderProfileRows(container, profile);
      li.setAttribute(ENRICHED_ATTR, "true");
      // Only move the element after successful enrichment.
      // Also avoid moving it if it is already the last child.
      if (li.parentElement && li.parentElement.lastElementChild !== li) {
        li.parentElement.appendChild(li);
      }
      console.log("✅ Enriched work profile item:", profile.id);
      return true;
    }

    function enrichSelectedEmployment(workProfiles = []) {
      const selectedProfileId = document
        .querySelector("ui5-popover-xweb-people-profile[initial-focus]")
        ?.getAttribute("initial-focus");

      const profile =
        workProfiles.length === 1
          ? workProfiles[0]
          : workProfiles.find(p => p?.id === selectedProfileId);

      if (!profile) return false;

      const selectedEmployment = document.querySelector("#selectedEmployment");
      const fullProfileContainer = findFullProfileDetailContainer();

      if (!selectedEmployment && !fullProfileContainer) return false;

      const enrichmentMarkerEl = selectedEmployment || fullProfileContainer;

      if (enrichmentMarkerEl.getAttribute(SELECTED_ENRICHED_ATTR) === profile.id) {
        return true;
      }

      const container = selectedEmployment
        ? findEmploymentContainer(selectedEmployment)
        : fullProfileContainer;

      if (!container) return false;

      renderProfileRows(container, profile);

      enrichmentMarkerEl.setAttribute(SELECTED_ENRICHED_ATTR, profile.id);

      console.log("✅ Enriched selected employment:", profile.id);

      return true;
    }

    function enrichWorkProfiles(workProfiles = []) {
      let remaining = [...workProfiles];
      let selectedDone = false;
      let scheduled = false;
      let disconnected = false;

      const observer = new MutationObserver(() => {
        scheduleTryEnrich();
      });

      function disconnectObserver() {
        if (disconnected) return;
        disconnected = true;
        observer.disconnect();
      }

      function shouldStopObserving() {
        return remaining.length === 0 && selectedDone;
      }

      function scheduleTryEnrich() {
        if (scheduled || disconnected) return;

        scheduled = true;

        requestAnimationFrame(() => {
          scheduled = false;
          tryEnrich();
        });
      }

      function tryEnrich() {
        if (disconnected) return;

        remaining = remaining.filter(profile => !enrichWorkProfileItem(profile));
        selectedDone = enrichSelectedEmployment(workProfiles) || selectedDone;

        if (shouldStopObserving()) {
          disconnectObserver();
          console.log("✅ All available work profile items enriched.");
        }
      }

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      scheduleTryEnrich();

      setTimeout(() => {
        disconnectObserver();

        const shouldWarn = remaining.length > 0 && !selectedDone;

        if (shouldWarn) {
          console.warn(
            "⚠️ Some work profile items were not found in DOM:",
            remaining.map(p => p.id)
          );
        }
      }, 10000);
    }

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
        console.log("workforcePersonProfile.id:", id);
        if (!id) return;

        try {
          const workforcePersonProfile =
            await liveProfileEnrichment.getWorkforcePersonProfileDetails(id);

          // Ignore stale fetch results.
          if (runId !== liveProfileEnrichmentRunId) {
            console.log("Ignoring stale live profile enrichment result:", id);
            return;
          }

          workforcePersonProfile.workProfiles = (workforcePersonProfile.workProfiles ?? [])
            .sort((a, b) => (b.hireDate ?? "").localeCompare(a.hireDate ?? ""));

          for (const wp of workforcePersonProfile.workProfiles ?? []) {
            wp.personIdExternal = workforcePersonProfile?.externalId;
          }

          liveProfileEnrichment.enrichWorkProfiles(
            workforcePersonProfile?.workProfiles || [],
            runId
          );
        } catch (err) {
          console.error("Failed to fetch workforcePersonProfile details:", err);
        }
      })
      .catch(err => {
        console.error("Failed to parse WorkProfile response JSON:", err);
      });
  }

  function handleLiveProfileCostAssignmentFetch({ response }) {
    response
      .clone()
      .json()
      .then(data => {
        const timeslice = data?.$data?.timeslices?.[0];
        const items = timeslice?.items || [];

        if (!items.length) return;

        enrichLiveProfileCostAssignmentCards(items);
      })
      .catch(err => {
        console.error("Failed to parse Cost Assignment response JSON:", err);
      });
  }

  function enrichLiveProfileCostAssignmentCards(items) {
    const enrichedAttr = "data-sapsf-ui-hack-cost-assignment-enriched";
    const timeoutMs = 10000;

    const enrichableItems = items
      .map(item => ({
        percentage: item?.percentage,
        code: item?.workBreakdownStructureDetail?.code
      }))
      .filter(item => item.code && item.percentage !== null && item.percentage !== undefined);

    if (!enrichableItems.length) return;

    let done = false;

    function findAdditionalAssignmentCards() {
      return [...document.querySelectorAll('ui5-text-xweb-people-profile[title="Additional Assignment"]')]
        .map(titleEl =>
          titleEl.closest(
            'div[class^="ListCard_itemContent__"], div[class*=" ListCard_itemContent__"]'
          )
        )
        .filter(Boolean);
    }

    function findPercentageEl(card, percentage) {
      const percentageText = `${percentage}%`;

      return [...card.querySelectorAll("ui5-text-xweb-people-profile")]
        .find(el =>
          el.getAttribute("title") === percentageText ||
          el.getAttribute("aria-label") === percentageText ||
          el.textContent.trim() === percentageText
        );
    }

    function appendCode(percentageEl, code) {
      if (!percentageEl || percentageEl.getAttribute(enrichedAttr) === "true") {
        return false;
      }

      const bdi = percentageEl.querySelector("bdi") || percentageEl;
      const currentText = bdi.textContent.trim();

      if (currentText.includes(code)) {
        percentageEl.setAttribute(enrichedAttr, "true");
        return true;
      }

      bdi.textContent = `${currentText} · ${code}`;

      percentageEl.setAttribute("title", `${currentText} · ${code}`);
      percentageEl.setAttribute("aria-label", `${currentText} · ${code}`);
      percentageEl.setAttribute(enrichedAttr, "true");

      return true;
    }

    function tryEnrich() {
      const cards = findAdditionalAssignmentCards();
      if (!cards.length) return false;

      let enrichedCount = 0;

      for (const item of enrichableItems) {
        const card = cards.find(candidate => findPercentageEl(candidate, item.percentage));
        const percentageEl = card && findPercentageEl(card, item.percentage);

        if (appendCode(percentageEl, item.code)) {
          enrichedCount++;
        }
      }

      if (enrichedCount) {
        console.log("✅ Cost Assignment cards enriched:", enrichedCount);
      }

      return enrichedCount === enrichableItems.length;
    }

    if (tryEnrich()) return;

    const observer = new MutationObserver(() => {
      if (done) return;

      if (tryEnrich()) {
        done = true;
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title", "aria-label"]
    });

    setTimeout(() => {
      observer.disconnect();

      if (!done) {
        console.warn("⚠️ Cost Assignment cards could not be fully enriched.");
      }
    }, timeoutMs);
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

    function fireJuicFromAttr(el, attr, fallbackEvent) {
      const code = el?.getAttribute(attr);
      const match = code && code.match(/juic\.fire$["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
      if (!match) return false;
      juic.fire(match[1], match[2], fallbackEvent);
      return true;
    }

    function isCheckboxReady(checkbox) {
      return (
        checkbox &&
        typeof window.juic?.fire === "function" &&
        checkbox.getAttribute("onclick")?.includes("juic.fire")
      );
    }

    function tickCheckbox() {
      const checkbox = document.querySelector(checkboxSelector);
      if (!isCheckboxReady(checkbox)) {
        return false;
      }
      checkbox.click();
      fireJuicFromAttr(checkbox, "onclick", {
        type: "click",
        target: checkbox,
        currentTarget: checkbox,
        preventDefault() {},
        stopPropagation() {}
      });
      console.log("✅ Document Generator checkbox ticked.");
      return true;
    }

    function trySetUser() {
      const input = document.querySelector(userSelector);
      if (!isJuicReady(input)) {
        return false;
      }
      const success = juicSetValue(input, `${userId}`);
      if (success) {
        console.log("✅ Document Generator user prefilled:", userId);
      }
      return success;
    }

    function tryInit() {
      if (!tickCheckbox()) return false;
      if (!trySetUser()) return false;
      return true;
    }

    if (tryInit()) return;

    const observer = new MutationObserver(() => {
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

  function initPositionPendingWorkflowLink() {
    const timeoutMs = 10000;
    const workflowUrl =
      "/odata/v2/restricted/Position?%24format=json&%24expand=wfRequestNav&recordStatus=pending&fromDate=2020-01-01&%24select=code,wfRequestNav%2FwfRequestId";

    let pendingPositionWorkflowsPromise = null;

    function findPendingWorkflowAlert() {
      return [...document.querySelectorAll('div[role="alert"]')]
        .find(el => el.innerText?.toLowerCase().includes("pending workflow"));
    }

    function fetchPendingPositionWorkflows() {
      if (!pendingPositionWorkflowsPromise) {
        pendingPositionWorkflowsPromise = fetchJson(workflowUrl)
          .then(data => data?.d?.results || []);
      }
      return pendingPositionWorkflowsPromise;
    }

    function findWorkflowRequestId(results, positionCode) {
      const position = results.find(item => item?.code === positionCode);

      return position?.wfRequestNav?.results?.[0]?.wfRequestId || null;
    }

    function appendWorkflowLink(alertEl, wfRequestId) {
      if (!alertEl || !wfRequestId) return false;

      if (alertEl.querySelector('[data-sapsf-ui-hack-workflow-link="true"]')) {
        return true;
      }

      const link = document.createElement("a");
      link.dataset.sapsfUiHackWorkflowLink = "true";
      link.href = `/xi/ui/ect/pages/workflowApproval/ectWorkflowApproval.xhtml?workflowRequestId=${encodeURIComponent(wfRequestId)}`;
      link.textContent = `Open workflow #${wfRequestId}`;
      link.style.marginLeft = "0.5rem";
      link.style.textDecoration = "underline";
      link.style.fontWeight = "bold";

      alertEl.appendChild(link);

      console.log("✅ Pending workflow link appended:", wfRequestId);

      return true;
    }

    async function tryAppendWorkflowLink() {
      const alertEl = findPendingWorkflowAlert();
      const positionCode = getPositionCodeFromPage();

      // Keep observing until both page elements exist.
      if (!alertEl || !positionCode) return false;

      const results = await fetchPendingPositionWorkflows();
      const wfRequestId = findWorkflowRequestId(results, positionCode);

      if (!wfRequestId) {
        console.warn("⚠️ Pending workflow request not found for position:", positionCode);
        return true;
      }

      return appendWorkflowLink(alertEl, wfRequestId);
    }

    let done = false;

    const observer = new MutationObserver(() => {
      if (done) return;

      safeRun("positionPendingWorkflowLink observer", async () => {
        if (await tryAppendWorkflowLink()) {
          done = true;
          observer.disconnect();
        }
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    safeRun("positionPendingWorkflowLink initial run", async () => {
      if (await tryAppendWorkflowLink()) {
        done = true;
        observer.disconnect();
      }
    });

    setTimeout(() => {
      observer.disconnect();

      if (!done) {
        console.warn("⚠️ Pending workflow alert not found or workflow link could not be added.");
      }
    }, timeoutMs);
  }

  function initPositionRecentIncumbentLink() {
    const timeoutMs = 10000;
    const LINK_ATTR = "data-sapsf-ui-hack-recent-incumbent-link";

    const incumbentPromiseByPositionCode = new Map();
    const userPromiseByUserId = new Map();

    let scheduled = false;

    function findToolbar() {
      return document.querySelector(".sfToolbar");
    }

    function removeRecentIncumbentLink() {
      document
        .querySelectorAll(`[${LINK_ATTR}="true"]`)
        .forEach(el => el.remove());
    }

    function fetchRecentIncumbentUserId(positionCode) {
      if (!positionCode) return Promise.resolve(null);

      if (!incumbentPromiseByPositionCode.has(positionCode)) {
        const escapedPositionCode = positionCode.replace(/'/g, "''");

        const url =
          `/odata/v2/restricted/EmpJob?%24format=json` +
          `&%24filter=position%20eq%20'${encodeURIComponent(escapedPositionCode)}'` +
          `&fromDate=${today}` +
          `&%24select=userId`;

        incumbentPromiseByPositionCode.set(
          positionCode,
          fetchJson(url).then(data => data?.d?.results?.[0]?.userId || null)
        );
      }

      return incumbentPromiseByPositionCode.get(positionCode);
    }

    function fetchUserDisplayName(userId) {
      if (!userId) return Promise.resolve(null);

      if (!userPromiseByUserId.has(userId)) {
        const url =
          `/odata/v2/restricted/User(%27${encodeURIComponent(userId)}%27)` +
          `?%24format=json&%24select=displayName`;

        userPromiseByUserId.set(
          userId,
          fetchJson(url).then(data => data?.d?.displayName || null)
        );
      }

      return userPromiseByUserId.get(userId);
    }

    function appendRecentIncumbentLink(toolbar, positionCode, userId, displayName) {
      if (!toolbar || !positionCode) return false;

      removeRecentIncumbentLink();

      const container = document.createElement("span");
      container.setAttribute(LINK_ATTR, "true");
      container.dataset.positionCode = positionCode;
      container.className = "toolbarButtonContainer btn";

      if (!userId) {
        container.textContent = "Recent incumbent: None";
        container.style.marginLeft = "0.5rem";
        container.style.opacity = "0.75";
        toolbar.prepend(container);

        console.log("✅ Recent incumbent empty marker appended:", positionCode);

        return true;
      }

      const a = document.createElement("a");
      a.href = `/sf/liveprofile?selected_user=${encodeURIComponent(userId)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className =
        "globalIconFont1Container fd-button fd-button--compact fd-button--transparent toolbarButtonWithLabel toolbarButton";
      a.title = `Open incumbent profile: ${displayName || userId}`;
      a.style.marginLeft = "0.5rem";
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
      text.textContent = `Recent incumbent: ${displayName || userId} (${userId})`;

      label.appendChild(text);
      outer.append(icon, label);
      a.appendChild(outer);
      container.appendChild(a);
      toolbar.appendChild(container);

      console.log("✅ Recent incumbent link appended:", positionCode, userId, displayName);

      return true;
    }

    let inFlightPositionCode = null;
    let successfulRenderCount = 0;

    function findExistingRecentIncumbentLink(positionCode) {
      return document.querySelector(
        `[${LINK_ATTR}="true"][data-position-code="${CSS.escape(positionCode)}"]`
      );
    }

    async function enrichRecentIncumbentIfNeeded() {
      const positionCode = getPositionCodeFromPage();
      if (!positionCode) return false;

      const toolbar = findToolbar();
      if (!toolbar) return false;

      // If the current DOM already has the correct enrichment, do nothing.
      // This avoids double enrichment.
      const existingLink = findExistingRecentIncumbentLink(positionCode);
      if (existingLink && toolbar.contains(existingLink)) {
        return true;
      }

      // Avoid starting duplicate async enrichments for the same position while one is running.
      if (inFlightPositionCode === positionCode) {
        return false;
      }

      inFlightPositionCode = positionCode;

      try {
        const userId = await fetchRecentIncumbentUserId(positionCode);

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
        const currentExistingLink = findExistingRecentIncumbentLink(positionCode);
        if (currentExistingLink && currentToolbar.contains(currentExistingLink)) {
          return true;
        }

        removeRecentIncumbentLink();

        const success = appendRecentIncumbentLink(
          currentToolbar,
          positionCode,
          userId,
          displayName
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

        safeRun("positionRecentIncumbentLink refresh", async () => {
          await enrichRecentIncumbentIfNeeded();
        });
      });
    }

    const observer = new MutationObserver(() => {
      scheduleEnrichment();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
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



  /**************************************************************************
   * 6. Bootstrap
   **************************************************************************/

  function bootstrap() {
    safeRun("applyStyleHacks", applyStyleHacks);
    safeRun("startKeepSessionAliveWhenAvailable", startKeepSessionAliveWhenAvailable);
    safeRun("addGlobalSearchCommands", addGlobalSearchCommands);

    safeRun("runMatchingRouteFeatures", runMatchingRouteFeatures);
    safeRun("installFetchWatcher", installFetchWatcher);

    console.log("✅ SAP SuccessFactors UI Hack userscript ready.");
  }

  bootstrap();

})();