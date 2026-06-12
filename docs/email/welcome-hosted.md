# Welcome email: hosted mission (send on every paid order)

Until transactional email is wired (Resend), send this manually from
support@warpchart.dev when the sale notification arrives on Discord.
Replace `{{repo}}` and, for Fleet, keep the extra paragraph.

---

**Subject:** your mission is live: {{repo}} is now under hourly telemetry

**Body (plain text, works pasted into any client):**

Welcome aboard.

Tracking for {{repo}} is active as of this hour. From now on, every hour
of your star history is being recorded permanently: this is the data that
can never be backfilled later, and it is yours forever (export anytime,
self-host anytime: the software is MIT).

Your console: https://warpchart.dev/r/{{repo}}

One honest note about the first hours: the collector has just started
walking your repository's full history backwards. Most repos resolve
within a couple of hours; very large ones can take a few more. If a panel
still shows a placeholder tonight, that is the backfill at work, not a
problem. Everything fills in on its own.

What you have now:
- The full mission console: velocity, projections, daily ladder, heatmap,
  rank over time and the mission log with spike forensics
- Embeds with EXACT live counters for your README
- Alerts for milestone gates and incoming overtakes (Discord, Slack or
  RSS: reply to this email and we will wire them with you)

[FLEET ONLY] Your plan covers up to 10 repositories and {{repo}} is the
first. Reply to this email with the rest of your fleet (owner/name, one
per line) and they will be live within the day.

If anything looks off, just reply: this inbox reaches a human who also
happens to be the maintainer.

Safe travels to the core,
Santiago · warpchart.dev

---

**Notas de envío (no incluir):** enviar desde support@warpchart.dev
(responder con hi@santifer.io funciona: el reply-to llega igual). El
retraso citado ("a couple of hours") cubre el peor caso del primer
backwalk + el siguiente tick del collector; el webhook ya dispara el
collector inmediatamente al pagar.
