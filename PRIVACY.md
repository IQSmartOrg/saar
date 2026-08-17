# Privacy Policy

_Last updated: 18 August 2026_

Saar is a Chrome extension that records Google Meet captions and turns them into
minutes. This describes exactly what it stores and what it sends, and is written
against the source in this repository — every claim below is checkable.

Saar has **no backend**. There is no Saar server, no account to create, and no
analytics, telemetry, crash reporting or tracking of any kind.

## What Saar stores, and where

All of it stays on your machine, in your Chrome profile.

| What | Where | Why |
|---|---|---|
| Meeting transcripts — captions, speaker names, timestamps | IndexedDB (`saar`) | The record of the meeting |
| Minutes — summary, topics, decisions, action items | IndexedDB (`saar`) | The output you asked for |
| Your settings, including the model API key you enter | `chrome.storage.local` | To work the next time you open Chrome |
| Name and email of the Google accounts signed into this profile | `chrome.storage.local` | So you can pick the notetaker by name instead of a number |
| In-flight session and summarisation state | `chrome.storage.session` / `.local` | So a meeting survives Chrome suspending the extension |

Settings use `chrome.storage.local` and never `chrome.storage.sync`. That is
deliberate: `sync` replicates to every device on your Google account, and an API
key should not travel.

Nothing is ever uploaded for backup. Deleting a meeting in Saar deletes its
transcript and minutes outright; removing the extension removes everything.

## What Saar sends, and to whom

Two destinations, both of which you choose. Saar sends data nowhere else.

**1. Your AI model — only if you turn on "Summarise with AI".**

This setting is **off by default**. While it is off, no transcript ever leaves
your machine.

When you turn it on, you choose the endpoint. Saar sends the transcript text and
your API key to that endpoint and to no other, in order to generate the minutes.
Where that is depends entirely on your choice:

- **Ollama or LM Studio** (the default) — a model on your own machine. Nothing
  leaves it.
- **OpenAI, Anthropic, Groq, OpenRouter, or a custom endpoint** — the transcript
  is sent to that provider, and their privacy policy and data-retention terms
  govern what happens to it from there. Saar is not party to that relationship.

Chrome asks for permission the moment you enable this, naming the specific host
you configured.

**2. `meet.google.com` — to list your Google accounts.**

To show the notetaker dropdown, Saar requests `meet.google.com/home?authuser=N`
for a handful of values of `N` and reads the account name and email out of the
page it gets back. This goes to Google, whom you are already signed in to, and
nowhere else. There is no supported Chrome API for this; it is the least
invasive way we found.

## What Saar does in your meetings

The notetaker joins as a **separate Google account you nominate**, with its
microphone and camera off. It does not speak, does not appear on camera, and
does not record audio or video — it reads Google Meet's own live captions, which
are a per-viewer setting and require nothing from the meeting host.

Other participants see the notetaker account in the participant list, as they
would any other attendee.

> **Recording other people.** Consent laws vary by country and by state, and in
> many places recording a conversation requires telling everyone in it. Saar
> makes the notetaker visible in the participant list, but that is not a
> substitute for asking. Whether and how you may record a given meeting is your
> responsibility.

## Children

Saar is a workplace tool and is not directed at children under 13.

## Changes

Material changes will be reflected here with a new date at the top, and in the
release notes for the version that carries them.

## Contact

Open an issue at https://github.com/IQSmartOrg/saar/issues.
