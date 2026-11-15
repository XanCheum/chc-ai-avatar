# CHC AI Avatar – "Meet Ah Ying"

A mobile web prototype of an AI avatar storyteller for the **Chinatown Heritage Centre (CHC)** in Singapore, built for a university research project.

A visitor scans a QR code, the page opens on their phone, an animated avatar ("Ah Ying", a fictional Samsui woman from old Chinatown) introduces itself, the visitor asks questions by tapping, typing, or speaking, and the avatar answers aloud using prepared stories. At the end the visitor opens a feedback survey.

> **Prototype – fictional character based on CHC stories.** All content comes from `content/stories.json`. No historical facts are invented by the code.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page structure (start screen, avatar, chat, controls). |
| `style.css` | Mobile-first styling, heritage colours, avatar + animations. |
| `app.js` | Logic: loads the stories, animates the avatar, speaks answers, matches questions. |
| `content/stories.json` | **All the text.** Edit this to change what Ah Ying says. |

No frameworks, no build step, no backend. Plain HTML, CSS and JavaScript.

## How to edit the stories (`content/stories.json`)

You do **not** need to touch the code to change the content. Open `content/stories.json` and edit the text.

- **`character.name`** – the avatar's name. This also sets the start-screen title ("Meet &lt;name&gt;") and the page title.
- **`character.greeting_en`** – what Ah Ying says first.
- **`survey_url`** – the feedback survey link. While it is set to `"PLACEHOLDER"`, the finish button shows "Survey link coming soon". Replace it with a real URL (e.g. a Google Form) to make the button open the survey.
- **`stories`** – a list of topics. Each one has:
  - `id` – a short name (must be unique).
  - `keywords` – words to match against the visitor's question (lower-case; the matching ignores case and punctuation). More matching keywords = more likely to be chosen.
  - `suggested_question_en` – the text shown on the tappable suggestion button.
  - `answer_en` – what Ah Ying replies.
- **`fallback_en`** – the reply used when no story matches the question.

**Tips**
- Keep the quotes `"` and commas `,` exactly as shown. A good free JSON checker is <https://jsonlint.com> if the page stops loading after an edit.
- Keep answers short and in Ah Ying's voice.

### Adding a Chinese version later

The code is already bilingual-ready. To add Chinese, add fields ending in `_zh` next to the English ones, for example:

```json
{
  "character": {
    "name": "Ah Ying",
    "greeting_en": "Hello! I'm Ah Ying...",
    "greeting_zh": "你好！我是阿英……"
  },
  "fallback_en": "That's a good question! ...",
  "fallback_zh": "好问题！……",
  "stories": [
    {
      "id": "home",
      "keywords": ["home", "house", "家", "房间"],
      "suggested_question_en": "What was your home like?",
      "suggested_question_zh": "你的家是什么样的？",
      "answer_en": "I lived in a shophouse...",
      "answer_zh": "我住在一间店屋……"
    }
  ]
}
```

A **中文 / English** toggle button appears automatically **only when `_zh` fields exist**. With English-only content there is no toggle.

## How to turn on GitHub Pages

1. Push this repository to GitHub (the files must be in the repository root, which they are).
2. On GitHub, open the repository and go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the branch (usually `main`) and the `/ (root)` folder, then **Save**.
5. Wait about a minute. GitHub shows the live URL, e.g. `https://<your-username>.github.io/chc-ai-avatar/`.
6. Create a QR code pointing to that URL (any free QR generator works) and display it at the exhibit.

All paths in the site are **relative**, so it works correctly from the project subfolder that GitHub Pages uses.

## Running locally

Because the page loads `content/stories.json`, opening `index.html` directly with `file://` is blocked by browsers. Run a tiny local server instead:

```bash
# Python 3
python3 -m http.server 8000
```

Then open <http://localhost:8000> on your computer, or on your phone using your computer's IP address on the same Wi-Fi.

## Browser support & notes

- **Speech (talking aloud)** uses the Web Speech API (`speechSynthesis`), supported on iPhone Safari and Android Chrome. The **Start** button is required so the browser allows audio to play.
- **Voice input (microphone)** uses `SpeechRecognition`. It appears **only** on browsers that support it (mainly Chrome); on others the mic button is hidden and visitors can still tap suggestions or type.
- A **mute** button turns speech on/off at any time.
- Designed mobile-first, works from 360px wide, with large text and large tap targets.
