BRIGHTWORKS BOT — TERMUX SETUP
==============================

IMPORTANT
- This project uses Baileys, an unofficial WhatsApp Web connection library. It is not made or endorsed by WhatsApp.
- Automated or unofficial connections can stop working and may risk account restrictions. Use only with your own account, follow WhatsApp's rules, and do not spam.
- Never share your linking code or the auth_info folder. Anyone with the saved session may be able to use your linked session.
- The dashboard binds to 127.0.0.1, so it is only available on this phone by default.

1) Install Termux from a trusted source, then open it.
2) Run:
   pkg update && pkg upgrade
   pkg install nodejs-lts
3) Put this whole project folder in Termux storage or copy the files into a folder named brightworks-bot.
   If using Android shared storage, first run:
   termux-setup-storage
4) Enter the project folder:
   cd brightworks-bot
5) Install dependencies:
   npm install
6) Start the bot and dashboard:
   npm start
7) Enter your own WhatsApp number with country code and digits only, e.g. 2348012345678.
8) Keep the pairing code private. On WhatsApp open Settings > Linked devices > Link a device > Link with phone number instead, then enter the code.
9) Open your browser on the same phone and visit:
   http://127.0.0.1:3000
10) In WhatsApp, try .menu in a chat or group.

STOP:
Press Ctrl+C in Termux.

RESTART:
cd brightworks-bot
npm start

SUPPORTED / LIMITATIONS
- Group commands need the bot to be an admin where WhatsApp requires it.
- .mute/.unmute change the group so only admins can post / let members post again; they do not mute one individual.
- .add may fail due to the target member's privacy settings; WhatsApp may require an invite link.
- .setpp works only if the quoted image can be downloaded and the bot has permission; if it fails, change the group picture manually.
- .clear is intentionally disabled. A bot cannot erase everyone's entire chat history.
- .meme sends a text meme, not an image.
- .rank uses a simple local points store; this starter does not include a full competitive leaderboard.
- Data is stored in data.json on this phone. Back it up if needed. Keep auth_info private.
- Welcome/goodbye depend on the library receiving group participant events.
- Anti-link and anti-spam are basic filters, not foolproof moderation.
- This is a starter project. Test admin commands in a private test group first.

OWNER NUMBER
Optional: set OWNER_NUMBER in the Termux environment before starting:
export OWNER_NUMBER=2348012345678
npm start

The local dashboard is not public hosting. It only works while Termux and the bot process are running.
