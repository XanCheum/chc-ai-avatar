/* ============================================================
   CHC AI Avatar – app logic
   Plain JavaScript, no libraries. Loads all text from
   content/stories.json, drives the avatar animations, speaks
   with the Web Speech API, matches questions to stories, and
   shows the conversation as chat bubbles.

   Non-programmers: you normally do NOT need to edit this file.
   To change what the character says, edit content/stories.json instead.
   ============================================================ */

(function () {
  "use strict";

  /* ---- Grab the elements we need from the page ---- */
  var startScreen = document.getElementById("start-screen");
  var chatScreen  = document.getElementById("chat-screen");
  var startBtn    = document.getElementById("start-btn");
  var startTitle  = document.getElementById("start-title");
  var avatar      = document.getElementById("avatar");
  var avatarPhoto = document.getElementById("avatar-photo");
  var avatarVideo = document.getElementById("avatar-video");
  var subtitleEl  = document.getElementById("avatar-subtitle");
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
  var audioUnlocked = false; // set true once the Start tap unlocks audio
  var videoToken = 0;     // increments per media attempt to cancel stale timers/handlers

  // Where the character videos live (relative path for GitHub Pages subfolders).
  var VIDEO_DIR = "content/videos/";
  // How long to wait for a video to become playable before giving up.
  var VIDEO_LOAD_TIMEOUT_MS = 4000;

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

  // Turn the breathing-zoom + sound bars on/off. The .speaking class on
  // #avatar drives both (see style.css). Used by the TTS fallback path.
  function setSpeakingState(on) {
    if (!avatar) return;
    if (on) avatar.classList.add("speaking");
    else avatar.classList.remove("speaking");
  }

  function speak(text) {
    if (muted || !synth || !text) {
      setSpeakingState(false);
      return;
    }
    try {
      synth.cancel(); // stop anything currently being said
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = (lang === "zh") ? "zh-CN" : "en-US";
      utter.rate = 0.95;
      utter.pitch = 1.05;
      // Breathing-zoom + sound bars while speaking (photo fallback path).
      utter.onstart = function () { setSpeakingState(true); };
      // When speech finishes (or errors) we are back to the idle photo, so
      // stop the breathing-zoom / sound bars and clear the on-screen subtitle.
      utter.onend   = function () { setSpeakingState(false); setSubtitle(""); };
      utter.onerror = function () { setSpeakingState(false); setSubtitle(""); };
      synth.speak(utter);
    } catch (e) {
      // If speech fails we still showed the text, so continue quietly.
      setSpeakingState(false);
    }
  }

  function setMuted(next) {
    muted = next;
    muteBtn.setAttribute("aria-pressed", String(muted));
    // Keep the <video> audio in sync with the mute state.
    if (avatarVideo) avatarVideo.muted = muted;
    if (muted) {
      muteBtn.textContent = "🔇 Sound off";
      muteBtn.setAttribute("aria-label", "Unmute speech");
      // Stop TTS (there is no silent TTS), but leave any playing video
      // running: setting avatarVideo.muted above already silenced it, so
      // the visitor keeps watching the clip without sound. When TTS was
      // the active path, cancelling it means nothing is "speaking", so
      // drop the breathing-zoom / sound bars and clear the subtitle.
      if (synth) synth.cancel();
      if (avatarVideo && avatarVideo.hidden) {
        // Photo + TTS path was active: no video to keep, so reset to idle.
        setSpeakingState(false);
        setSubtitle("");
      }
    } else {
      muteBtn.textContent = "🔊 Sound on";
      muteBtn.setAttribute("aria-label", "Mute speech");
    }
  }

  /* ============================================================
     SUBTITLES
     The current greeting/answer text is always shown on-screen,
     whether a video plays or we fall back to photo + TTS.
     ============================================================ */
  function setSubtitle(text) {
    if (subtitleEl) subtitleEl.textContent = text || "";
  }

  /* ============================================================
     MEDIA FRAME: photo <-> video
     The photo is shown by default. A video is played in the same
     box when it loads; otherwise we fall back to photo + TTS.
     Resolution is purely by file name (per-story = <id>.mp4), so
     new videos can be added later just by uploading them.
     ============================================================ */

  // Show the still photo and stop/hide the video.
  function showPhoto() {
    if (avatarVideo) {
      try { avatarVideo.pause(); } catch (e) {}
      avatarVideo.hidden = true;
      avatarVideo.removeAttribute("src");
      // Detach the current source so the browser stops loading it.
      try { avatarVideo.load(); } catch (e) {}
    }
    if (avatarPhoto) avatarPhoto.hidden = false;
  }

  // Speak text with TTS over the photo (breathing-zoom + sound bars).
  function playWithTts(text) {
    showPhoto();
    speak(text);
  }

  /**
   * Try to play the first video in `candidates` (file names relative to
   * content/videos/). On success the video plays with its own audio and
   * the view returns to the photo when it ends. On failure (missing file,
   * load error, stall, rejected play(), or no "canplay" within the
   * timeout) we fall back to photo + TTS of `text`.
   *
   * A static host may serve an HTML 404 page instead of a real media
   * error, so we treat a load timeout as a failure too.
   */
  function playVideoOrFallback(candidates, text) {
    var list = (candidates || []).slice();

    if (!avatarVideo || list.length === 0) {
      playWithTts(text);
      return;
    }

    var token = ++videoToken; // invalidates any earlier attempt
    tryCandidate(0);

    function isCurrent() { return token === videoToken; }

    function tryCandidate(i) {
      if (!isCurrent()) return;
      if (i >= list.length) { playWithTts(text); return; }

      var timer = null;
      var settled = false;

      function cleanup() {
        if (timer) { clearTimeout(timer); timer = null; }
        avatarVideo.removeEventListener("canplay", onCanPlay);
        avatarVideo.removeEventListener("loadeddata", onCanPlay);
        avatarVideo.removeEventListener("error", onFail);
        avatarVideo.removeEventListener("stalled", onFail);
      }

      function onFail() {
        if (settled || !isCurrent()) return;
        settled = true;
        cleanup();
        tryCandidate(i + 1); // try the next candidate, else TTS
      }

      function onCanPlay() {
        if (settled || !isCurrent()) return;
        settled = true;
        cleanup();
        // The video loaded: show it, stop any TTS, and let it play.
        if (synth) synth.cancel();
        setSpeakingState(false);
        if (avatarPhoto) avatarPhoto.hidden = true;
        avatarVideo.hidden = false;
      }

      avatarVideo.addEventListener("canplay", onCanPlay);
      avatarVideo.addEventListener("loadeddata", onCanPlay);
      avatarVideo.addEventListener("error", onFail);
      avatarVideo.addEventListener("stalled", onFail);

      // When the clip ends, return to the still photo and clear the
      // subtitle so the last answer does not stay overlaid on the idle photo.
      avatarVideo.onended = function () {
        if (!isCurrent()) return;
        showPhoto();
        setSubtitle("");
      };

      // Audio only after the Start tap unlocked it; honour mute state.
      avatarVideo.muted = muted || !audioUnlocked;

      try {
        avatarVideo.src = VIDEO_DIR + list[i];
        avatarVideo.load();
        var p = avatarVideo.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () { onFail(); });
        }
      } catch (e) {
        onFail();
        return;
      }

      // No "canplay"/"loadeddata" in time -> treat as a failure.
      timer = setTimeout(onFail, VIDEO_LOAD_TIMEOUT_MS);
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

  // Avatar says something: show bubble + subtitle, then play the matching
  // video (if any) or fall back to photo + TTS. `candidates` is an ordered
  // list of video file names (relative to content/videos/) to try.
  function avatarSay(text, candidates) {
    addBubble("avatar", text);
    setSubtitle(text);
    playVideoOrFallback(candidates || [], text);
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
      // Return the matched story so the ask flow can resolve its video by id.
      return { text: field(best, "answer"), id: best.id || null };
    }
    // No match: fallback text and the shared fallback video.
    return { text: field(content, "fallback"), id: null };
  }

  // Full ask flow: show the visitor's bubble, then the answer. A matched
  // story plays content/videos/<id>.mp4; an unmatched question plays
  // content/videos/fallback.mp4. Either way we fall back to photo + TTS.
  function ask(question) {
    var text = (question || "").trim();
    if (!text) return;
    addBubble("visitor", text);
    var result = findAnswer(text);
    var candidates = result.id ? [result.id + ".mp4"] : ["fallback.mp4"];
    // Tiny delay so it feels like a reply, not an echo.
    setTimeout(function () { avatarSay(result.text, candidates); }, 250);
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
    // The Start tap is a user gesture, so audio is now allowed to play.
    audioUnlocked = true;
    // Greet the visitor: bubble + subtitle, then the greeting video.
    // The user asks for greeting.mp4; the file shipped on disk is
    // Greetings.mp4, so we try both and use the first that loads. If
    // neither loads we fall back to photo + TTS of the greeting text.
    avatarSay(field(content.character, "greeting"), ["greeting.mp4", "Greetings.mp4"]);
    askInput.focus();
  }

  function init() {
    loadContent()
      .then(function () {
        // Start-screen title uses the character's name from stories.json.
        var charName = (content.character && content.character.name) || "";
        if (startTitle && charName) {
          startTitle.textContent = "Meet " + charName;
          document.title = "Meet " + charName + " – Chinatown Heritage Centre";
        }
        // Refine the photo's alt text from the character description.
        if (avatarPhoto && charName) {
          avatarPhoto.alt = charName + ", a Samsui woman";
        }
        buildSuggestions();
        setupSurvey();
        setupMic();
        setupLangToggle();

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
        // Show a clear message if content failed to load. Derive the
        // heading from the character name when it is available; content
        // may be null here, so fall back to a neutral generic heading.
        var charName = (content && content.character && content.character.name) || "";
        var heading = charName ? ("Meet " + charName) : "Meet your guide";
        startScreen.innerHTML =
          '<h1 class="title"></h1>' +
          '<p class="subtitle">Sorry, the stories could not be loaded.</p>' +
          '<p class="disclaimer error-detail"></p>' +
          '<p class="disclaimer">If you are opening this file directly, run it from a web ' +
          'server (for example GitHub Pages) so content/stories.json can load.</p>';
        // Set dynamic text via textContent to avoid any HTML injection.
        var titleEl = startScreen.querySelector(".title");
        if (titleEl) titleEl.textContent = heading;
        var detailEl = startScreen.querySelector(".error-detail");
        if (detailEl) detailEl.textContent = String(err.message || err);
      });
  }

  // Kick things off once the page is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
