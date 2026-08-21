# Chrome Web Store listing

Reference content for the Developer Dashboard's submission form. This is not
read by any build step — copy the relevant field into the Dashboard by hand
when submitting or updating the listing.

## Store listing tab

**Category:** Productivity

**Language:** English (United States)

**Summary** (132 char limit, shown in search results):

> AI note-taking for your meetings. Joins your Google Meet calls, records captions, writes the minutes.

(Same string as `description` in `wxt.config.ts` — keep the two in sync.)

**Description:**

> Saar joins your Google Meet calls, writes down what was said and who said
> it, and turns it into a summary and minutes.
>
> When you join a call, Saar opens a second, muted tab signed in as a
> notetaker account you choose, joins the meeting with its microphone and
> camera off, turns on live captions, and records them as they arrive. When
> the meeting ends it hands the transcript to a language model and writes
> the minutes.
>
> — Joins only after you do. A Meet URL matches as soon as the pre-join
> screen loads, so Saar waits until it can see you are actually in the call.
> Sitting in the green room deciding does not summon a notetaker.
>
> — Never joins live. It refuses to press Join until it has confirmed both
> the microphone and the camera read as off.
>
> — Knows when to stop. Nine independent stop signals — you leaving, either
> tab closing, the bot being removed, captions drying up, a missed
> heartbeat — so a session cannot outlive the meeting even if your laptop
> sleeps or Chrome kills the worker.
>
> — Minutes with receipts. Summary, topics, decisions and action items, and
> every action item carries the sentence it came from.
>
> — Yours by default. Transcripts live in IndexedDB on your machine. The AI
> summary is off until you turn it on, and it defaults to a local Ollama, so
> nothing leaves the machine unless you point it somewhere else.
>
> — Survives being killed. Summarising runs one model call at a time and
> persists between them. An MV3 worker dying mid-run costs one chunk, not
> the meeting.
>
> Google Meet today. Full privacy policy and source: https://github.com/IQSmartOrg/saar

**Icon:** `assets/icon-128.png` (already built by `wxt build`, also at that repo path for upload if the dashboard asks for it separately)

**Screenshots** (1280×800, upload in this order): `assets/store/screenshot-1-meetings.png`,
`screenshot-2-provider.png`, `screenshot-3-setup.png`, `screenshot-4-recording.png`

**Promotional tile / marquee images:** not created — optional on the Dashboard, skip for the first submission.

**Homepage URL:** `https://iqsmartorg.github.io/saar/` (also set as `homepage_url` in the manifest)

**Support URL:** `https://github.com/IQSmartOrg/saar/issues`

**Mail:** whatever inbox you want store correspondence to reach — not currently declared anywhere in the repo.

## Privacy practices tab

**Single purpose:**

> Saar takes notes in your Google Meet calls: it joins as a second, muted
> Google account, records the call's live captions, and turns the transcript
> into a summary, decisions and action items.

**Permission justifications** — copied from the reasoning already written in `wxt.config.ts`:

| Permission | Justification |
|---|---|
| `tabs` | Needed to open the notetaker tab **muted**. `tabs.update({muted})` is the permission-bearing call — an unmuted bot tab would play the meeting out the speakers and re-enter the call as a feedback loop through the user's mic. |
| `storage` | Settings, resumable summarisation jobs, and live session state. |
| `notifications` | "Transcript saved", "minutes ready", and every failure — the only way to reach someone whose popup is shut. |
| `alarms` | The stop-signal watchdog. A `setTimeout` in an MV3 service worker dies with the worker, so the liveness guarantee needs an alarm to survive termination. |
| `host_permissions: https://meet.google.com/*` | The only site Saar reads or acts on — joining calls and reading captions. |
| `optional_host_permissions` (`localhost`, `127.0.0.1`, `https://*/*`) | Requested only at the moment the user turns on AI summaries, scoped to the one endpoint they configure (or localhost for Ollama/LM Studio). Never requested at install. |

**Data usage disclosures** (the Dashboard's per-category checklist):

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | The notetaker account's name/email is read from `meet.google.com` and kept in `chrome.storage.local` only, to populate the account picker. Never transmitted anywhere. |
| Health information | No | — |
| Financial and payment information | No | — |
| Authentication information | No | The AI provider API key the user enters is stored in `chrome.storage.local` and sent only to the endpoint the user configures — never to Saar or its developers. |
| Personal communications | Yes | Meeting captions/transcripts are the extension's core function. They stay on-device unless the user opts into AI summaries, in which case the transcript is sent only to the single endpoint the user chose. |
| Location | No | — |
| Web history | No | — |
| User activity | No | No click tracking, keylogging, or analytics of any kind. |
| Website content | Yes | Live captions are read from the active Meet tab in order to build the transcript. Same on-device/opt-in handling as personal communications above. |

**Certifications** (check all three on the Dashboard):
- Does not sell or transfer user data to third parties outside approved use cases.
- Does not use or transfer user data for purposes unrelated to the item's single purpose.
- Does not use or transfer user data to determine creditworthiness or for lending.

All three are true for Saar as shipped — see [`PRIVACY.md`](PRIVACY.md) for the full policy this is drawn from.
