// ==UserScript==
// @name         SAP SuccessFactors UI Hack
// @namespace    https://github.com/toooma/sapsf-ui-hack
// @version      0.1.5
// @description  Enhances SAP SuccessFactors UI.
// @match        https://hcm55.sapsf.eu/*
// @run-at       document-start
// @icon         https://img.icons8.com/ios-filled/100/circled-s.png
// @grant        none
// @updateURL    https://raw.githubusercontent.com/toooma/sapsf-ui-hack/main/sapsf-ui-hack.user.js
// @downloadURL  https://raw.githubusercontent.com/toooma/sapsf-ui-hack/main/sapsf-ui-hack.user.js
// ==/UserScript==

(() => {
  "use strict";

  const targetRegex =
    /\/rest\/workforce\/v1\/workforcePersonProfiles\//;

  const previousFetch = window.fetch.bind(window);
  let internalFetch = false;

  const ENRICHED_ATTR = "data-work-profile-enriched";
  const SELECTED_ENRICHED_ATTR = "data-selected-work-profile-enriched-id";

  console.log("🔍 SAP SuccessFactors UI Hack userscript starting...");

  applyStyleHacks();
  startKeepSessionAliveWhenAvailable();

  window.addEventListener("load", () => {
    console.log("SAPSF page loaded!");
  });

  function applyStyleHacks() {
    const style = document.createElement("style");

    style.textContent = `
      .ectTextArea {
        resize: both !important;
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
    internalFetch = true;

    try {
      const res = await window.fetch(url, {
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
    } finally {
      internalFetch = false;
    }
  }

  function createUi5Text(label, value) {
    if (!value) return null;

    const el = document.createElement("ui5-text-xweb-people-profile");
    el.setAttribute("empty-indicator-mode", "Off");
    el.textContent = `${label}${label ? ": " : ""}${value}\u200e`;

    el.style.display = "block";
    el.style.fontSize = "0.75rem";
    el.style.opacity = "0.85";
    el.style.marginTop = "2px";
    el.style.textAlign = "start";

    return el;
  }

  function findEmploymentContainer(li) {
    return Array.from(li.querySelectorAll("div")).find(div =>
      Array.from(div.classList).some(cls =>
        cls.startsWith("EmploymentListItem_container__")
      )
    );
  }

  function replaceEmploymentTextAt(container, index, value) {
    if (!container || index == null || !value) return false;

    const textEls = container.querySelectorAll("ui5-text-xweb-people-profile");
    const targetEl = textEls[index];

    if (!targetEl) return false;

    targetEl.textContent = `${value}\u200e`;
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

    replaceEmploymentTextAt(container, 1, profile?.custom05);

    const rows = [
      [
        "",
        [
          profile?.hireDate ? `▶️ Hire: ${profile.hireDate}` : null,
          profile?.companyExitDate ? `🔴 Exit: ${profile.companyExitDate}` : null
        ].filter(Boolean).join(" ")
      ],
      ["Position", profile.custom02],
      ["Department", profile.departmentName],
      ["User Id", profile.legacyId]
    ];

    for (const [label, value] of rows) {
      const textEl = createUi5Text(label, value);
      if (textEl) container.appendChild(textEl);
    }

    li.setAttribute(ENRICHED_ATTR, "true");

    console.log("✅ Enriched work profile item:", profile.id);

    return true;
  }

  function enrichSelectedEmployment(workProfiles = []) {
    const popover = document.querySelector(
      "ui5-popover-xweb-people-profile[initial-focus]"
    );

    const selectedProfileId = popover?.getAttribute("initial-focus");
    if (!selectedProfileId) return false;

    const profile = workProfiles.find(p => p?.id === selectedProfileId);
    if (!profile) return false;

    const selectedEmployment = document.querySelector("#selectedEmployment");
    if (!selectedEmployment) return false;

    if (
      selectedEmployment.getAttribute(SELECTED_ENRICHED_ATTR) === selectedProfileId
    ) {
      return true;
    }

    const container = findEmploymentContainer(selectedEmployment);
    if (!container) return false;

    replaceEmploymentTextAt(container, 1, profile?.custom05);

    container
      .querySelectorAll("[data-selected-work-profile-extra='true']")
      .forEach(el => el.remove());

    const rows = [
      [
        "",
        [
          profile?.hireDate ? `▶️ Hire: ${profile.hireDate}` : null,
          profile?.companyExitDate ? `🔴 Exit: ${profile.companyExitDate}` : null
        ].filter(Boolean).join(" ")
      ],
      ["Position", profile.custom02],
      ["Department", profile.departmentName],
      ["User Id", profile.legacyId]
    ];

    for (const [label, value] of rows) {
      const textEl = createUi5Text(label, value);

      if (textEl) {
        textEl.setAttribute("data-selected-work-profile-extra", "true");
        container.appendChild(textEl);
      }
    }

    selectedEmployment.setAttribute(SELECTED_ENRICHED_ATTR, selectedProfileId);

    console.log("✅ Enriched selected employment:", selectedProfileId);

    return true;
  }

  function enrichWorkProfiles(workProfiles = []) {
    let remaining = [...workProfiles];

    const tryEnrich = () => {
      remaining = remaining.filter(profile => !enrichWorkProfileItem(profile));

      const selectedDone = enrichSelectedEmployment(workProfiles);

      if (!remaining.length && selectedDone) {
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

    if (internalFetch) return response;

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
              const workforcePersonProfile = await fetchJson(
                `/rest/workforce/v1/workforcePersonProfiles/${id}?$expand=workProfiles($select=id,displayTitle,legacyId,displayName,departmentName,departmentId,locationName,locationId,isPrimary,assignmentTag,isActive,workerType,timeZone,hireDate,serviceDate,companyExitDate,custom02,custom05,hrManagerId)&$select=id,personId,displayName,internalId,externalId,email,dateOfBirth`
              );

              console.log("workforcePersonProfile details:", workforcePersonProfile);

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
})();