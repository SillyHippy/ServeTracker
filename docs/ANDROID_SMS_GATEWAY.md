# Optional SMS: Android phone or Better Auth

ServeTracker can send field alerts and phone-verification codes without a paid SMS vendor. This branch documents the two supported paths. Neither path is required to run the app.

## Which path should you use?

| Need | Recommended path | Cost |
|---|---|---|
| Job assigned / attempt logged / affidavit ready texts to field servers | **Android SMS Gateway** on a spare or work phone | Carrier SMS only — typically $0 on an unlimited plan |
| Sign-in codes, phone verification, password-reset OTPs | **Better Auth** phone plugin, delivered by that same Android phone | Same as above (self-hosted auth, no per-MAU fee) |
| High-volume marketing or blast campaigns | Do **not** use this stack | Use a licensed aggregator; carriers throttle handset senders |

Keep business texts on a dedicated work SIM. Do not run the gateway on a personal phone you also use for everyday messaging.

---

## Path 1 — Free Android SMS Gateway

Official project (link this, not a fork):

- Repository: [https://github.com/capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway)
- Releases / APK: [https://github.com/capcom6/android-sms-gateway/releases](https://github.com/capcom6/android-sms-gateway/releases)
- Docs: [https://docs.sms-gate.app](https://docs.sms-gate.app)
- API: [https://docs.sms-gate.app/integration/api/](https://docs.sms-gate.app/integration/api/)
- License: Apache-2.0

The app turns an Android 5.0+ phone into an HTTP SMS modem. ServeTracker posts a JSON body; the phone sends a normal carrier SMS.

### 1. Install the app

1. Prefer the **release / secure** APK (`app-release.apk`) from [Releases](https://github.com/capcom6/android-sms-gateway/releases). Do not use the `insecure` build in production.
2. On Android 13+, grant **SMS**. If the permission is greyed out after a sideload: **Settings → Apps → SMS Gateway → ⋮ → Allow restricted settings**, then grant SMS again.
3. Set battery use to **Unrestricted** so the OS does not kill the listener overnight.

### 2. Choose a server mode

| Mode | When to use | Endpoint |
|---|---|---|
| **Public Cloud Server** (recommended for a VPS) | Phone and server are not on the same LAN. No Tailscale or port-forward. | `https://api.sms-gate.app/3rdparty/v1/messages` |
| **Local Server** | Server can reach the phone on Wi-Fi / VPN. | `http://<phone-lan-ip>:8080/message` |
| **Private Server** | You want the relay on your own infrastructure. | See [Private Server](https://docs.sms-gate.app/getting-started/) |

Cloud mode: toggle **Cloud Server** → **Online**. The app shows a username and password. Copy those into your server environment — never into git.

Local mode: toggle **Local Server** → **Offline** (starts the on-device listener). Use the LAN IP the app displays.

### 3. Configure ServeTracker

```env
SMS_GATEWAY_ENABLED=true
SMS_GATEWAY_API_URL=https://api.sms-gate.app/3rdparty/v1/messages
SMS_GATEWAY_USER=your_app_username
SMS_GATEWAY_PASS=your_app_password
# Optional when several phones share one cloud account:
SMS_GATEWAY_DEVICE_ID=
```

Send numbers in E.164 (`+19185551234`). US inputs such as `(918) 555-1234` should be normalized to `+1` + 10 digits before POST.

### 4. Send a test (cloud)

```bash
curl -X POST -u "$SMS_GATEWAY_USER:$SMS_GATEWAY_PASS" \
  -H "Content-Type: application/json" \
  -d '{
    "textMessage": { "text": "ServeTracker SMS gateway test" },
    "phoneNumbers": ["+15555550100"]
  }' \
  https://api.sms-gate.app/3rdparty/v1/messages
```

Local test is the same body against `http://<phone-ip>:8080/message`.

A `2xx` from the relay means the cloud accepted the job. Delivery still depends on the phone being online, SMS permission granted, and the carrier accepting the message.

### 5. Production notes

- One phone is enough for a small agency. Add a second SIM / device if you need failover; the cloud account can attach multiple devices.
- Respect your carrier’s terms. This is for transactional ops texts, not bulk advertising.
- Rotate the app password if a device is lost. Treat `SMS_GATEWAY_PASS` like any other secret.
- Log outbound attempts (`pending` / `processed` / `failed`) in your own database. Do not log full message bodies in world-readable files.

---

## Path 2 — Better Auth phone OTP (same sender)

[Better Auth](https://github.com/better-auth/better-auth) is a self-hosted TypeScript auth framework. The [phone number plugin](https://www.better-auth.com/docs/plugins/phone-number) issues OTPs; **you** implement `sendOTP`. Point that hook at the Android gateway from Path 1.

This gives you:

- Phone sign-in / sign-up
- Phone verification for existing users
- Password reset by SMS
- No Clerk / Auth0 per-user fee

Auth tables stay in your SQLite file. The Android phone is only the delivery channel.

### Install

```bash
bun add better-auth
```

### Server plugin

```ts
import { betterAuth } from "better-auth";
import { phoneNumber } from "better-auth/plugins";

export const auth = betterAuth({
  // ...your existing email/password + SQLite config
  plugins: [
    phoneNumber({
      sendOTP: ({ phoneNumber, code }) => {
        // Do not await the SMS HTTP call here — it opens a timing side channel
        // and slows the request. Fire-and-forget, same pattern as field alerts.
        void sendSms({
          to: phoneNumber,
          message: `Your ServeTracker verification code is ${code}`,
        });
      },
    }),
  ],
});
```

`sendSms` is the same helper you use for field alerts: Basic auth POST to `SMS_GATEWAY_API_URL` with `{ textMessage: { text }, phoneNumbers: [e164] }`.

### Client plugin

```ts
import { createAuthClient } from "better-auth/client";
import { phoneNumberClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});
```

Then `authClient.phoneNumber.sendOtp({ phoneNumber })` and `authClient.phoneNumber.verify({ phoneNumber, code })` as documented in the [phone number plugin](https://www.better-auth.com/docs/plugins/phone-number).

### Google / email still work

Better Auth can sit next to email/password and Google OAuth. Phone OTP is additive. If you only want operational SMS and not phone login, skip this path and use Path 1 alone.

---

## Security checklist

- [ ] Dedicated work phone / SIM, not a personal daily driver
- [ ] Release APK, not the insecure build
- [ ] SMS + unrestricted battery on the handset
- [ ] Secrets only in server env / secret store — never in the public repo
- [ ] E.164 numbers only; reject anything that will not normalize
- [ ] Rate-limit OTP send endpoints (Better Auth has a built-in limiter; still cap your own `/api` wrappers)
- [ ] Do not send case documents, SSNs, or sealed pleadings over SMS

---

## References

- [capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway) — the exact gateway this integration uses
- [SMS Gateway docs](https://docs.sms-gate.app)
- [Better Auth](https://github.com/better-auth/better-auth)
- [Better Auth phone number plugin](https://www.better-auth.com/docs/plugins/phone-number)
