# Authenticated console verification

Start pnpm dev in another terminal. Use the explicit development authentication
mode and synthetic fixtures. Install Python browser-test dependencies separately:

    python -m pip install -r tests/browser/requirements.txt
    python -m playwright install chromium
    python tests/browser/tenant_console.py

VERIQO_WEB_URL overrides the default http://127.0.0.1:3000. Use the same origin as
VERIQO_APP_URL. VERIQO_CHROMIUM_EXECUTABLE optionally selects a system Chromium.
Screenshots and the synthetic JSON export go to test-results/tenant-console,
overridden by VERIQO_BROWSER_OUTPUT. Generated evidence is ignored by Git.

The check covers sign-in/logout, encrypted HttpOnly cookie properties, absence of
localStorage credentials, cross-origin mutation rejection, scenario publication,
PASS and wrong-tenant FAIL, export, cross-tenant denial, viewer restrictions and
mobile overflow. It requires no live OIDC provider. This local reference browser
check does not qualify the product browser adapter or production isolation.
