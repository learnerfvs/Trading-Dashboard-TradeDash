/* global browser */
// Cross-browser helpers
const ext = (typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null));

// Open dashboard in new tab when extension icon is clicked
(function registerActionClick() {
    function openDashboardWithRuntimeURL(runtime) {
        const url = runtime.getURL('dashboard.html');
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url });
        } else if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.create) {
            browser.tabs.create({ url });
        } else {
            console.warn('No tabs.create available to open dashboard');
        }
    }

    // Register both chrome/browser APIs; note: if a popup is configured the onClicked event may not fire.
    if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
        chrome.action.onClicked.addListener(() => { console.log('action.onClicked (chrome.action) fired'); openDashboardWithRuntimeURL(chrome.runtime); });
    }
    if (typeof chrome !== 'undefined' && chrome.browserAction && chrome.browserAction.onClicked) {
        chrome.browserAction.onClicked.addListener(() => { console.log('browserAction.onClicked (chrome.browserAction) fired'); openDashboardWithRuntimeURL(chrome.runtime); });
    }
    if (typeof browser !== 'undefined' && browser.action && browser.action.onClicked) {
        browser.action.onClicked.addListener(() => { console.log('action.onClicked (browser.action) fired'); openDashboardWithRuntimeURL(browser.runtime); });
    }
    if (typeof browser !== 'undefined' && browser.browserAction && browser.browserAction.onClicked) {
        browser.browserAction.onClicked.addListener(() => { console.log('browserAction.onClicked (browser.browserAction) fired'); openDashboardWithRuntimeURL(browser.runtime); });
    }
    // Additionally, add a runtime message handler so UI or popup can request opening of the dashboard
    if (typeof (ext && ext.runtime && ext.runtime.onMessage) !== 'undefined') {
        ext.runtime.onMessage.addListener((msg) => {
            if (msg && msg.action === 'openDashboard') {
                console.log('Received openDashboard message');
                openDashboardWithRuntimeURL(ext.runtime || chrome.runtime || browser.runtime);
            }
        });
    }
})();

// Background service worker for OAuth and API calls

if ((typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) || (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onInstalled)) {
    (ext && ext.runtime && ext.runtime.onInstalled ? ext.runtime.onInstalled : (() => {})).addListener(() => {
        console.log('Trading Dashboard Extension Installed');
    });
}

// Handle OAuth token requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getAuthToken') {
        getAuthToken(request.interactive)
            .then(token => sendResponse({ success: true, token: token }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
    
    if (request.action === 'removeAuthToken') {
        removeAuthToken()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'fetchSheetData') {
        fetchSheetData(request.token, request.spreadsheetId, request.range)
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// Get OAuth token (supports Chrome identity.getAuthToken and fallback to launchWebAuthFlow for Firefox)
function getAuthToken(interactive = true) {
    const manifest = (ext && ext.runtime && ext.runtime.getManifest) ? ext.runtime.getManifest() : null;
    const clientId = manifest && manifest.oauth2 && manifest.oauth2.client_id;
    const scopes = manifest && manifest.oauth2 && manifest.oauth2.scopes && manifest.oauth2.scopes.join(' ');

    function launchWebAuthFlowPromise(details) {
        return new Promise((resolve, reject) => {
            try {
                if (typeof browser !== 'undefined' && browser.identity && browser.identity.launchWebAuthFlow) {
                    browser.identity.launchWebAuthFlow(details).then(resolve).catch(reject);
                } else if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.launchWebAuthFlow) {
                    chrome.identity.launchWebAuthFlow(details, (resp) => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                        else resolve(resp);
                    });
                } else {
                    reject(new Error('No launchWebAuthFlow available'));
                }
            } catch (e) { reject(e); }
        });
    }

    return new Promise((resolve, reject) => {
        // Prefer chrome.identity.getAuthToken when available (Chrome)
        if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken) {
            chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!token) {
                    reject(new Error('No token received'));
                } else {
                    resolve(token);
                }
            });
            return;
        }

        // Fallback: use OAuth redirect + launchWebAuthFlow
        if (!clientId || !scopes) {
            reject(new Error('OAuth client info not found in manifest')); return;
        }
        const redirectUri = (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getRedirectURL) ? chrome.identity.getRedirectURL() : ((typeof browser !== 'undefined' && browser.identity && browser.identity.getRedirectURL) ? browser.identity.getRedirectURL() : null);
        if (!redirectUri) {
            reject(new Error('No redirect URI available for OAuth')); return;
        }
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&include_granted_scopes=true&prompt=${interactive ? 'consent' : 'none'}`;

        launchWebAuthFlowPromise({ interactive: interactive, url: authUrl })
            .then((redirectedTo) => {
                // Parse access_token from redirect URL fragment
                const m = redirectedTo && redirectedTo.match(/[#&]access_token=([^&]+)/);
                if (m && m[1]) resolve(decodeURIComponent(m[1]));
                else reject(new Error('No access_token found in redirect response'));
            })
            .catch(err => reject(err));
    });
}

// Remove OAuth token (sign out) - best-effort
function removeAuthToken() {
    return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken) {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
                if (token && chrome.identity.removeCachedAuthToken) {
                    chrome.identity.removeCachedAuthToken({ token: token }, () => resolve());
                } else {
                    resolve();
                }
            });
            return;
        }
        // Nothing to remove for launchWebAuthFlow flow
        resolve();
    });
}

// Fetch data from Google Sheets
function fetchSheetData(token, spreadsheetId, range) {
    return new Promise((resolve, reject) => {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
        
        fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + token
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to fetch sheet data: ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            resolve(data.values || []);
        })
        .catch(error => {
            reject(error);
        });
    });
}


