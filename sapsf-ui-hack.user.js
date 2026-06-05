// ==UserScript==
// @name         SAP SuccessFactors UI Hack
// @namespace    https://github.com/toooma/sapsf-ui-hack
// @version      0.6.1
// @description  Enhances SAP SuccessFactors UI.
// @match        https://hcm55.sapsf.eu/*
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
   *    - applyStyleHacks
   *    - startKeepSessionAliveWhenAvailable
   *    - addUserIdSearchCommand
   * 3. Route-based feature registry
   * 4. Fetch target registry
   * 5. Route-specific modules
   *    - Live Profile enrichment
   * 6. Bootstrap
   **************************************************************************/

  console.log("🔍 SAP SuccessFactors UI Hack userscript starting...");

  /**************************************************************************
   * 1. Global constants / utilities
   **************************************************************************/

  const originalFetch = window.fetch.bind(window);

  const ROUTES = {
    LIVE_PROFILE: "/sf/liveprofile"
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

  function addUserIdSearchCommand() {
    const introOriginals = new WeakMap();

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
      if (!intro || intro.dataset.userIdIntroMarkupObserverAttached === "true") {
        return;
      }

      intro.dataset.userIdIntroMarkupObserverAttached = "true";

      const observer = new MutationObserver(() => {
        if (!isIntroMarkupReady(intro)) return;

        observer.disconnect();
        delete intro.dataset.userIdIntroMarkupObserverAttached;

        enhanceIntroNow(intro);
      });

      observer.observe(intro, {
        attributes: true,
        attributeFilter: ["markup", "no-search-result-msg"]
      });

      setTimeout(() => {
        if (!introOriginals.has(intro) && isIntroMarkupReady(intro)) {
          observer.disconnect();
          delete intro.dataset.userIdIntroMarkupObserverAttached;

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

      const userIdSearchOption = `
        <li data-user-id-search-option="true">
          <span class="searchItemIcon globalIconFont1Support">
            <ui5-icon-sf-header class="icon" name="person-placeholder" mode="Image"></ui5-icon-sf-header>
          </span>
          <span class="searchItemText">User ID, using “u:”, for example “u:123456”</span>
        </li>
      `;

      if (!originalMarkup.includes("data-user-id-search-option")) {
        const enhancedMarkup = originalMarkup.includes("</ul>")
          ? originalMarkup.replace("</ul>", `${userIdSearchOption}</ul>`)
          : `${originalMarkup}${userIdSearchOption}`;

        intro.setAttribute("markup", enhancedMarkup);
      }

      console.log("✅ User ID search intro enhanced.");
    }

    function updateUserIdHint(input) {
      const value = input.value.trim();
      const isUserIdCommand = value.toLowerCase().startsWith("u:");

      const { search } = getSearchParts();
      const intro = getIntro(search);
      if (!intro) return;

      ensureIntroEnhanced(intro);

      const original = introOriginals.get(intro);

      intro.setAttribute(
        "no-search-result-msg",
        isUserIdCommand
          ? "Enter the User ID, then press Enter."
          : original?.noSearchResultMsg || "No matching results. Try a different search."
      );
    }

    function attachUserIdSearchCommand() {
      const { input, search } = getSearchParts();
      if (!input) return false;

      const intro = getIntro(search);
      if (intro) ensureIntroEnhanced(intro);

      if (input.dataset.userIdSearchCommandAttached === "true") return true;
      input.dataset.userIdSearchCommandAttached = "true";

      input.addEventListener(
        "input",
        () => {
          updateUserIdHint(input);
        },
        true
      );

      input.addEventListener(
        "keydown",
        event => {
          if (event.key !== "Enter") return;

          const value = input.value.trim();
          if (!value.toLowerCase().startsWith("u:")) return;

          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();

          const userId = value.slice(2).trim();
          if (!userId) return;

          window.location.href =
            `/sf/liveprofile?selected_user=${encodeURIComponent(userId)}`;
        },
        true
      );

      console.log("✅ User ID search command attached.");

      return true;
    }

    if (attachUserIdSearchCommand()) return;

    const observer = new MutationObserver(() => {
      if (attachUserIdSearchCommand()) {
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
    }

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
    }

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

      if (label) {
        el.append(`${label}: `);
      }

      if (label === "Position") {
        const link = createPositionLink(value);
        el.append(link || value);
      } else {
        el.append(value);
      }

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

    function buildProfileRows(profile) {
      return [
        [
          "",
          [
            profile?.hireDate ? `▶️ Hire: ${profile.hireDate}` : null,
            profile?.companyExitDate ? `🔴 Exit: ${profile.companyExitDate}` : null
          ]
            .filter(Boolean)
            .join(" ")
        ],
        ["Position", profile.custom02],
        ["Department", profile.departmentName],
        ["Entity", profile.custom05],
        [
          "",
          [
            profile?.personIdExternal ? `PersonId: ${profile.personIdExternal}` : null,
            profile?.legacyId ? `UserId: ${profile.legacyId}` : null
          ]
            .filter(Boolean)
            .join(" ")
        ],
        ["", profile.isActive ? "🟢 Active" : "⚫ Inactive"]
      ];
    }

    function renderProfileRows(container, profile) {
      if (!container || !profile) return false;

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

      if (li.getAttribute(ENRICHED_ATTR) === "true") return true;

      const container = findEmploymentContainer(li);
      if (!container) return false;

      renderProfileRows(container, profile);

      li.setAttribute(ENRICHED_ATTR, "true");

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

      const shouldStopObserving = () =>
        remaining.length === 0 ||
        selectedDone ||
        workProfiles.length === 1;

      const tryEnrich = () => {
        remaining = remaining.filter(profile => !enrichWorkProfileItem(profile));
        selectedDone = enrichSelectedEmployment(workProfiles) || selectedDone;

        if (shouldStopObserving()) {
          observer.disconnect();
          console.log("✅ All available work profile items enriched.");
        }
      };

      const observer = new MutationObserver(tryEnrich);

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      tryEnrich();

      setTimeout(() => {
        observer.disconnect();

        const shouldWarn =
          remaining.length > 0 &&
          !selectedDone &&
          workProfiles.length !== 1;

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

  function handleLiveProfileWorkforcePersonProfileFetch({ response }) {
    const liveProfileEnrichment = window.sapSfUiHackLiveProfileEnrichment;

    if (!liveProfileEnrichment) {
      console.warn("⚠️ Live Profile enrichment module is not initialized.");
      return;
    }

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

          for (const wp of workforcePersonProfile.workProfiles ?? []) {
            wp.personIdExternal = workforcePersonProfile?.externalId;
          }

          liveProfileEnrichment.enrichWorkProfiles(
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

  /**************************************************************************
   * 6. Bootstrap
   **************************************************************************/

  function bootstrap() {
    safeRun("applyStyleHacks", applyStyleHacks);
    safeRun("startKeepSessionAliveWhenAvailable", startKeepSessionAliveWhenAvailable);
    safeRun("addUserIdSearchCommand", addUserIdSearchCommand);

    safeRun("runMatchingRouteFeatures", runMatchingRouteFeatures);
    safeRun("installFetchWatcher", installFetchWatcher);

    console.log("✅ SAP SuccessFactors UI Hack userscript ready.");
  }

  bootstrap();
})();