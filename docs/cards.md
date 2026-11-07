# Digital card, NFC/QR and attendance

## What it is
Every employee, instructor and student whose account is linked to a record has **one identity card**, shown in the web app (installable
PWA, works on every phone, no store fees) as a bank-card-shaped card: chip, contactless mark, grouped number, holder name. Tapping it
flips it to the back, which shows a **QR code that changes every 30 seconds** (HMAC-signed with `CARD_HMAC_SECRET`, one 30-second step of
tolerance), so a screenshot is useless. The design follows the structure of NFC Tools (bottom tab bar, "bring the card close" sheet,
read/log lists) but is our own.

## Who does what
| Action | Who | Endpoint |
|---|---|---|
| See my card, my log | any member with a holder record | `GET /api/cards/mine`, `/cards/mine/presence` |
| Gate check-in/out (toggles automatically) | coordinator, branch manager, HR, admin (own branch) | `POST /api/presence/gate` `{payload}` |
| Instructor presence in the room | the instructor, scanning the room's signed tag during the scheduled session (-30 min to end) | `POST /api/presence/room` `{roomToken}` |
| Student attendance | the session's instructor (or coordinator/manager), scanning the student's card; only students registered in the session, once | `POST /api/presence/student` `{payload, sessionId}` |
| Issue/re-key a physical NFC tag | HR, branch manager, admin | `POST /api/cards/issue` (token shown once) |
| Stop a lost card | same roles, reason required | `POST /api/cards/:id/revoke` |
| Room tags to print / write | HR, branch manager, admin | `GET /api/cards/room-tags` |
| Today's log | gate roles | `GET /api/presence/today` |

Screens: `/card` (my card, scan, log — mobile-first with a bottom tab bar) and `/attendance` (cards, room tags, today's log).

## Security design
- A physical tag stores only a random opaque token (`ST1.…`), **never the chip UID** (UIDs are cloneable) and never personal data;
  only the token's hash is stored. Re-keying kills the previous token. Lost/revoked cards are refused immediately (HTTP 423).
- QR payloads `SQ1.<card>.<window>.<hmac>` expire after ~30-60 s; room tags `RM1.<room>.<hmac>` are static but only useful to a
  signed-in instructor with a session in that room at that time.
- Scanning is branch-scoped; every issue/re-key/revoke is audited (hash-chained ledger). Presence events keep method, scanner and IP.
- If `CARD_HMAC_SECRET` (32+ chars) is missing the card service answers 503 instead of working insecurely.

## Limits
- **iPhone:** Safari has no Web NFC, so on iPhone use the QR (camera). NFC reading/writing works on Android with Chrome over HTTPS.
  A phone cannot emulate an NFC card from a web page; the virtual card is the QR.
- Students, instructors and sessions are still legacy records; attendance created by scanning is written as the same legacy
  `attendance` record the manual flow creates, so reports keep working.
- Not built: employee shift/lateness rules, push notifications, a native app, offline scanning.
