# easy-retro

A small, self-hosted retrospective board. Write privately, reveal together, dot-vote, discuss, and leave with owned action items. Cards never show who wrote them.

It is a static site (plain HTML, CSS and JavaScript, no build step) that runs on GitHub Pages and keeps live state in your own Firebase Realtime Database. Each team deploys its own copy with its own Firebase project. Nothing in this repository points at any particular deployment.

## How a retro runs

1. **Write.** Everyone adds cards to the columns. Until the reveal, each person sees only their own cards. This is enforced by the database rules, not just hidden on screen.
2. **Reveal.** The facilitator opens the board. Cards carry no names, so people can volunteer to talk about their own.
3. **Vote.** Each person spends a fixed number of votes. Totals stay hidden until discussion so nobody piles on.
4. **Discuss.** Cards are sorted by votes. The facilitator highlights the card being discussed for everyone, and anyone can add action items with an owner and due date.
5. **Wrap up.** Copy the summary as Markdown or download it, then delete the retro if you don't want to keep the data.

The facilitator also has a shared countdown timer (1, 3, 5 or 10 minutes, plus one more minute, or stop).

Formats: Went well / Didn't go well / Try next, Start / Stop / Continue, the 4 Ls, and Mad / Sad / Glad.

## Privacy model

- Everyone signs in with Firebase **anonymous** sign-in. No names, emails or accounts are collected.
- A card is stored with its column, text and timestamp only. A separate `owners` entry links each card to the writer's anonymous id so the writer can edit or delete it during the write phase. No client can read `owners`; only someone with admin access to the Firebase project can, and an anonymous id isn't tied to a person.
- Card order on the board comes from a hash of the card id, so the order doesn't show who wrote what or when.
- Anyone with a retro link can join that retro. Retro ids are random, and the database doesn't let clients list retros.
- Only browsers listed under `admins` can create retros, so a public deployment can't be used by strangers to create boards.

## Set up your own deployment

You need a Google account for Firebase and a GitHub repository (a fork of this one is fine).

### 1. Firebase

1. Create a project in the [Firebase console](https://console.firebase.google.com/). Analytics isn't needed.
2. **Authentication** > Get started > Sign-in method > enable **Anonymous**.
3. **Realtime Database** > Create database > pick a location > start in **locked mode**.
4. In the database **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json) and publish.
5. **Project settings** > General > Your apps > add a **Web** app (no Hosting needed). Copy the config object it shows.
6. **Authentication** > Settings > Authorized domains: add your Pages domain (for example `your-user.github.io`).

### 2. GitHub

1. Repository **Settings** > Secrets and variables > Actions > **New repository secret** named `FIREBASE_WEB_CONFIG`. Its value is the web config as JSON, for example:

   ```json
   {"apiKey":"...","authDomain":"...","databaseURL":"...","projectId":"...","appId":"..."}
   ```

2. **Settings** > Pages > Source: **GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow by hand). The workflow writes `public/config.js` from the secret during the build, so the config never lands in the repository.

The Firebase web config is not a password. Any web app that uses Firebase sends it to the browser, so it will be visible in your deployed site. Access is controlled by the database rules and authentication, not by keeping the config hidden. Keeping it out of the repository just stops your project details from spreading with the code.

### 3. Make yourself a facilitator

1. Open your deployed site. Under "Start a retro" it shows this browser's id.
2. In the Firebase console, open **Realtime Database** > Data and add `admins/<that id>` with the value `true` (boolean).
3. Reload the site. You can now create retros from that browser.

Anonymous ids belong to one browser profile. If you facilitate from another browser, add that id too.

## Local development

```sh
cp public/config.example.js public/config.js   # then fill in your web config
python3 -m http.server 8080 --directory public
```

Open http://localhost:8080. Add `localhost` to the authorized domains if Firebase asks.

## Limits

- Facilitator controls belong to the browser that created the retro.
- No card grouping or merging yet. Duplicate cards can be removed by the facilitator after the reveal.
- The Firebase free plan (Spark) allows 100 simultaneous connections to the Realtime Database, which is plenty for a team retro.

## License

[MIT](LICENSE)
