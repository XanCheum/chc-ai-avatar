/* ============================================================
   CHC AI Avatar – app logic
   Plain JavaScript, no libraries. Loads all text from
   content/stories.json, drives the avatar animations, speaks
   with the Web Speech API, matches questions to stories, and
   shows the conversation as chat bubbles.

   Non-programmers: you normally do NOT need to edit this file.
   To change what Ah Mei says, edit content/stories.json instead.
   ============================================================ */

(function () {
  "use strict";

  /* ---- Grab the elements we need from the page ---- */
  var startScreen = document.getElementById("start-screen");
  var chatScreen  = document.getElementById("chat-screen");
  var startBtn    = document.getElementById("start-btn");
  var avatar      = document.getElementById("avatar");
  var chatLog     = document.getElementById("chat-log");
  var suggestions = document.getElementById("suggestions");
  var askForm     = document.getElementById("ask-form");
  var askInput    = document.getElementById("ask-input");
  var muteBtn     = document.getElementById("mute-btn");
  var micBtn      = document.getElementById("mic-btn");
  var langBtn     = document.getElementById("lang-btn");
  var surveyBtn   = document.getElementById("survey-btn");
  var surveyMsg   = document.getElementById("survey-msg");

  /* ---- State ---- */
  var content = null;     // parsed stories.json
  var lang = "en";        // current language: "en" or "zh"
  var hasZh = false;      // does the content include _zh fields?
  var muted = false;      // is speech muted?
  var recognition = null; // SpeechRecognition instance (if supported)

  /* ============================================================
     LANGUAGE HELPERS
     Every piece of text has an English field (e.g. answer_en)
     and optionally a Chinese field (answer_zh). field() picks
     the right one for the current language, falling back to EN.
     ============================================================ */
  function field(obj, base) {
    if (!obj) return "";
    var val = obj[base + "_" + lang];
    if (val === undefined || val === null || val === "") {
      val = obj[base + "_en"]; // fall back to English
    }
    return val || "";
  }

  // Does any object in the content carry a _zh field? If so we
  // show the language toggle; otherwise we keep it hidden.
  function detectZh(data) {
    function objHasZh(o) {
      return o && Object.keys(o).some(function (k) {
        return /_zh$/.test(k) && o[k];
      });
    }
    if (objHasZh(data.character)) return true;
    if (objHasZh(data)) return true; // fallback_zh lives on root
    return (data.stories || []).some(objHasZh);
  }

  /* ============================================================
     LOAD CONTENT
     ============================================================ */
  function loadContent() {
    // Relative path so it works on GitHub Pages in a subfolder.
    return fetch("content/stories.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load stories.json (" + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        content = data;
        hasZh = detectZh(data);
      });
  }

  /* ============================================================
     SPEECH (speechSynthesis)
     Speaks text aloud unless muted or unsupported.
     ============================================================ */
  var synth = window.speechSynthesis || null;

  function speak(text) {
    if (muted || !synth || !text) return;
    try {
      synth.cancel(); // stop anything currently being said
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = (lang === "zh") ? "zh-CN" : "en-US";
      utter.rate = 0.95;
      utter.pitch = 1.05;
      // Animate the mouth while speaking.
      utter.onstart = function () { avatar.classList.add("speaking"); };
      utter.onend   = function () { avatar.classList.remove("speaking"); };
      utter.onerror = function () { avatar.classList.remove("speaking"); };
      synth.speak(utter);
    } catch (e) {
      // If speech fails we still showed the text, so continue quietly.
    }
  }

  function setMuted(next) {
    muted = next;
    muteBtn.setAttribute("aria-pressed", String(muted));
    if (muted) {
      muteBtn.textContent = "🔇 Sound off";
      muteBtn.setAttribute("aria-label", "Unmute speech");
      if (synth) synth.cancel();
      avatar.classList.remove("speaking");
    } else {
      muteBtn.textContent = "🔊 Sound on";
      muteBtn.setAttribute("aria-label", "Mute speech");
    }
  }

  /* ============================================================
     CHAT BUBBLES
     ============================================================ */
  function addBubble(who, text) {
    var bubble = document.createElement("div");
    bubble.className = "bubble " + (who === "avatar" ? "bubble-avatar" : "bubble-visitor");
    if (who === "avatar") {
      var name = document.createElement("span");
      name.className = "speaker";
      name.textContent = field(content.character, "name") || content.character.name;
      bubble.appendChild(name);
    }
    var p = document.createElement("span");
    p.textContent = text; // textContent avoids any HTML injection
    bubble.appendChild(p);
    chatLog.appendChild(bubble);
    // Keep the newest message in view.
    chatLog.scrollTop = chatLog.scrollHeight;
    return bubble;
  }

  // Avatar says something: show bubble + speak it.
  function avatarSay(text) {
    addBubble("avatar", text);
    speak(text);
  }

  /* ============================================================
     ANSWER MATCHING
     Case-insensitive, simple whole-word matching of the
     visitor's question against each story's keywords. The story
     with the most keyword hits wins. No match -> fallback text.
     ============================================================ */
  function normaliseWords(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ") // drop punctuation
      .split(/\s+/)
      .filter(Boolean);
  }

  function findAnswer(question) {
    var words = normaliseWords(question);
    var wordSet = {};
    words.forEach(function (w) { wordSet[w] = true; });

    var best = null;
    var bestScore = 0;

    (content.stories || []).forEach(function (story) {
      var score = 0;
      (story.keywords || []).forEach(function (kw) {
        // A keyword may itself be multi-word; match each part.
        var parts = String(kw).toLowerCase().split(/\s+/);
        var hit = parts.every(function (p) { return wordSet[p]; });
        if (hit) score += 1;
      });
      if (score > bestScore) {
        bestScore = score;
        best = story;
      }
    });

    if (best && bestScore > 0) {
      return field(best, "answer");
    }
    return field(content, "fallback");
  }

  // Full ask flow: show the visitor's bubble, then the answer.
  function ask(question) {
    var text = (question || "").trim();
    if (!text) return;
    addBubble("visitor", text);
    var answer = findAnswer(text);
    // Tiny delay so it feels like a reply, not an echo.
    setTimeout(function () { avatarSay(answer); }, 250);
  }

  /* ============================================================
     SUGGESTED QUESTION BUTTONS (one per story)
     ============================================================ */
  function buildSuggestions() {
    suggestions.innerHTML = "";
    (content.stories || []).forEach(function (story) {
      var q = field(story, "suggested_question");
      if (!q) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = q;
      btn.addEventListener("click", function () { ask(q); });
      suggestions.appendChild(btn);
    });
  }

  /* ============================================================
     BLINKING
     Add the .blinking class briefly at random intervals.
     ============================================================ */
  function scheduleBlink() {
    var delay = 2500 + Math.random() * 3000; // every ~2.5–5.5s
    setTimeout(function () {
      avatar.classList.add("blinking");
      setTimeout(function () { avatar.classList.remove("blinking"); }, 140);
      scheduleBlink();
    }, delay);
  }

  /* ============================================================
     MICROPHONE (SpeechRecognition) – only if supported
     ============================================================ */
  function setupMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // not supported -> leave the mic button hidden

    recognition = new SR();
    recognition.lang = (lang === "zh") ? "zh-CN" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = function (event) {
      var said = event.results[0][0].transcript;
      askInput.value = said;
      ask(said);
      askInput.value = "";
    };
    recognition.onend = function () { micBtn.classList.remove("mic-listening"); };
    recognition.onerror = function () { micBtn.classList.remove("mic-listening"); };

    micBtn.hidden = false;
    micBtn.addEventListener("click", function () {
      try {
        if (synth) synth.cancel();        // don't record ourselves
        recognition.lang = (lang === "zh") ? "zh-CN" : "en-US";
        micBtn.classList.add("mic-listening");
        recognition.start();
      } catch (e) {
        micBtn.classList.remove("mic-listening");
      }
    });
  }

  /* ============================================================
     SURVEY
     ============================================================ */
  function setupSurvey() {
    var url = content.survey_url;
    surveyBtn.addEventListener("click", function () {
      if (!url || url === "PLACEHOLDER") {
        surveyMsg.hidden = false; // show "Survey link coming soon"
        return;
      }
      // Open in a new tab; noopener for safety.
      window.open(url, "_blank", "noopener");
    });
  }

  /* ============================================================
     LANGUAGE TOGGLE (only shown when _zh content exists)
     ============================================================ */
  function updateLangButton() {
    // Button offers to switch to the OTHER language.
    langBtn.textContent = (lang === "en") ? "中文" : "English";
    langBtn.setAttribute("aria-label",
      (lang === "en") ? "Switch to Chinese" : "Switch to English");
  }

  function setupLangToggle() {
    if (!hasZh) return;           // no Chinese content -> stay hidden
    langBtn.hidden = false;
    updateLangButton();
    langBtn.addEventListener("click", function () {
      lang = (lang === "en") ? "zh" : "en";
      updateLangButton();
      buildSuggestions();          // re-label suggestions in new language
      if (recognition) recognition.lang = (lang === "zh") ? "zh-CN" : "en-US";
    });
  }

  /* ============================================================
     START
     ============================================================ */
  function startConversation() {
    startScreen.hidden = true;
    chatScreen.hidden = false;
    // Greet the visitor (bubble + speech). The Start tap unlocks audio.
    avatarSay(field(content.character, "greeting"));
    askInput.focus();
  }

  function init() {
    loadContent()
      .then(function () {
        buildSuggestions();
        setupSurvey();
        setupMic();
        setupLangToggle();
        scheduleBlink();

        muteBtn.addEventListener("click", function () { setMuted(!muted); });

        askForm.addEventListener("submit", function (e) {
          e.preventDefault();
          ask(askInput.value);
          askInput.value = "";
        });

        startBtn.addEventListener("click", startConversation);
        startBtn.disabled = false;
      })
      .catch(function (err) {
        // Show a clear message if content failed to load.
        startScreen.innerHTML =
          '<h1 class="title">Meet Ah Mei</h1>' +
          '<p class="subtitle">Sorry, the stories could not be loaded.</p>' +
          '<p class="disclaimer">' + String(err.message || err) + '</p>' +
          '<p class="disclaimer">If you are opening this file directly, run it from a web ' +
          'server (for example GitHub Pages) so content/stories.json can load.</p>';
      });
  }

  // Kick things off once the page is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
