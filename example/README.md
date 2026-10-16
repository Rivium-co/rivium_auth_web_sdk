# Rivium Auth Web SDK Example

A small Vite page that uses `@rivium/auth-web` from this repository (`"@rivium/auth-web": "file:.."`).

It shows:

- anonymous sign-in
- e-mail + password sign-up and sign-in, and linking an e-mail to a guest
- the current user id (`onAuthStateChanged`) and the project's enabled methods (`getMethods`)
- `getMe()` and `getToken()`
- sign-out and account deletion

## Run it

1. Turn on Rivium Auth for your project in [Rivium Console](https://console.rivium.co) and enable the
   **Anonymous** and **E-mail & password** methods.
2. Build the SDK once (the example uses its `dist/`):

   ```bash
   cd ..
   npm install
   npm run build
   ```

3. Set your **public** API key:

   ```bash
   cd example
   cp .env.example .env   # then set VITE_RIVIUM_API_KEY=rv_live_...
   ```

   Only the public key (`rv_live_...`) belongs in a browser app. Never put the server secret in it.

4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

The page opens at `http://localhost:5173`. The session lives in memory, so a reload signs you out; see the SDK
README for `localStorageStorage()`.
