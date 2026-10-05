# Reset email setup with Gmail

The local demo currently uses `RESET_DELIVERY=console`. In this mode the backend prints reset links in its terminal, so no email arrives. Gmail delivery is implemented, but a real message cannot be tested until a Gmail account and App Password are configured.

## Set up your sender

1. Choose a Gmail account to send the reset messages. A dedicated sender account is preferable for this small demo.
2. Enable [Google 2-Step Verification](https://support.google.com/accounts/answer/185839?hl=en) on that account. Then open [Google App Passwords](https://support.google.com/accounts/answer/185833?hl=en) and create a 16-character App Password for FreelanceChain. If the App Password option is unavailable, check Google's restrictions on that page.
3. In the local source, create `backend/.env` from `backend/.env.example`. Keep your existing MongoDB and JWT settings. Add or change these lines, replacing the placeholders locally:

   ```dotenv
   APP_ORIGIN=http://127.0.0.1:5010
   RESET_DELIVERY=gmail
   GMAIL_USER=your-address@gmail.com
   GMAIL_APP_PASSWORD=<your-16-character-app-password>
   ```

   Set `APP_ORIGIN` to the exact address where you open FreelanceChain. For a different port, change it here too. Do not include angle brackets in the actual password. Spaces displayed by Google are accepted, but you can enter the 16 characters without them. `backend/.env` is ignored by the project and must stay private. Do not paste the App Password into chat, screenshots, or frontend environment files.
4. Stop the running backend and start it again from `backend` with `npm start`. If your terminal has `$env:RESET_DELIVERY='console'` from the demo guide, run `Remove-Item Env:RESET_DELIVERY` first; that terminal setting overrides `.env`. Do the same for any old `APP_ORIGIN` terminal setting that does not match your browser address. The current Codex demo server also uses a console-mode terminal setting, so it must be restarted without that setting after you configure Gmail.
5. Open **Forgot password?**. It should now say **Send reset link**, without the local-demo note. Use an account registered with an inbox you can actually receive. The seeded `.local` sample emails are fictional and cannot receive mail. Check spam if the message is delayed.

The reset link expires after 15 minutes. The API deliberately shows the same result for registered and unknown addresses. If delivery fails, the backend records an error in its terminal and invalidates that reset token. With no App Password, recovery status is unavailable rather than pretending an email can be sent.

Gmail via App Password is intended for this small demo. Google may limit or reject automated sending; for a public deployment use a suitable email provider and an HTTPS `APP_ORIGIN`. [Nodemailer's Gmail guide](https://nodemailer.com/guides/using-gmail) explains the Gmail transport and its limits.
