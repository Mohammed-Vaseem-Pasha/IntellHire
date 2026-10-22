const fs = require("node:fs");
const path = require("node:path");
const { initializeApp, cert, applicationDefault, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function getFirebaseCredential() {
    const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (inlineJson) {
        try {
            return cert(JSON.parse(inlineJson));
        } catch {
            throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
        }
    }

    const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (configuredPath) {
        const absolutePath = path.resolve(configuredPath);
        if (!fs.existsSync(absolutePath)) {
            throw new Error("GOOGLE_APPLICATION_CREDENTIALS points to a file that does not exist.");
        }
        return cert(require(absolutePath));
    }

    // Backward compatibility for a developer's local, untracked credential file.
    const localKeyPath = path.join(__dirname, "serviceAccountKey.json");
    if (fs.existsSync(localKeyPath)) return cert(require(localKeyPath));

    // On supported hosting platforms, use the platform's application-default identity.
    return applicationDefault();
}

const app = getApps().length === 0
    ? initializeApp({ credential: getFirebaseCredential() })
    : getApps()[0];

const auth = getAuth(app);
module.exports = { auth };
