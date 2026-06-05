// ==UserScript==
// @name         SAP SuccessFactors UI Hack
// @namespace    https://github.com/toooma/sapsf-ui-hack
// @version      0.4.5
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

  console.log("🔍 SAP SuccessFactors UI Hack userscript starting...");

  applyStyleHacks();
  startKeepSessionAliveWhenAvailable();

  const previousFetch = window.fetch.bind(window);

  const targetRegex =
    /\/rest\/workforce\/v1\/workforcePersonProfiles\//;

  const ENRICHED_ATTR = "data-work-profile-enriched";
  const SELECTED_ENRICHED_ATTR = "data-selected-work-profile-enriched-id";

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

  async function fetchJson(url, options = {}) {
    const res = await previousFetch(url, {
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


  const profileDetailsCache = new Map();

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
        ].filter(Boolean).join(" ")
      ],
      ["Position", profile.custom02],
      ["Department", profile.departmentName],
      ["Entity", profile.custom05],
      [
        "",
        [
          profile?.personIdExternal ? `PersonId: ${profile.personIdExternal}` : null,
          profile?.legacyId ? `UserId: ${profile.legacyId}` : null
        ].filter(Boolean).join(" ")
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

    if (
      enrichmentMarkerEl.getAttribute(SELECTED_ENRICHED_ATTR) === profile.id
    ) {
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

    const tryEnrich = () => {
      remaining = remaining.filter(profile => !enrichWorkProfileItem(profile));

      const selectedDone = enrichSelectedEmployment(workProfiles);

      if (!remaining.length || selectedDone) {
        observer.disconnect();
        console.log("✅ All work profile items enriched.");
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

      if (remaining.length) {
        console.warn(
          "⚠️ Some work profile items were not found in DOM:",
          remaining.map(p => p.id)
        );
      }
    }, 10000);
  }

  window.fetch = async function (...args) {
    const response = await previousFetch(...args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;

      if (url && targetRegex.test(url)) {
        response
          .clone()
          .json()
          .then(async data => {
            const id = data?.id;

            console.log("workforcePersonProfile.id:", id);

            if (!id) return;

            try {
              const workforcePersonProfile = await getWorkforcePersonProfileDetails(id);
              // console.log("workforcePersonProfile details:", workforcePersonProfile);
              for (const wp of workforcePersonProfile.workProfiles ?? []) {
                wp.personIdExternal = workforcePersonProfile?.externalId;
              }
              enrichWorkProfiles(workforcePersonProfile?.workProfiles || []);
            } catch (err) {
              console.error("Failed to fetch workforcePersonProfile details:", err);
            }
          })
          .catch(err => {
            console.error("Failed to parse WorkProfile response JSON:", err);
          });
      }
    } catch (err) {
      console.error("Fetch watcher error:", err);
    }

    return response;
  };
  console.log("✅ Fetch watcher installed.");


  function addUserIdSearchCommand() {
    function getSearchParts() {
      const shellbar = document.querySelector("xweb-shellbar");
      const search = shellbar?.shadowRoot?.querySelector("#search");
      const input = search?.shadowRoot?.querySelector("#inner");

      return { shellbar, search, input };
    }
    function updateUserIdHint(input) {
      const value = input.value.trim();
      const isUserIdCommand = value.toLowerCase().startsWith("u:");

      const { search } = getSearchParts();
      if (!search) return;

      const intro =
        search.shadowRoot?.querySelector("xweb-global-search-intro") ||
        search.querySelector?.("xweb-global-search-intro");

      if (!intro) return;

      if (isUserIdCommand) {
        intro.setAttribute(
          "no-search-result-msg",
          "Navigating by User ID.."
        );
        intro.setAttribute("no-search-result", "true");
      } else {
        intro.setAttribute(
          "no-search-result-msg",
          "No matching results. Try a different search."
        );
      }
    }

    function attachUserIdSearchCommand() {
      const { input } = getSearchParts();
      if (!input) return false;

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

  addUserIdSearchCommand();


})();