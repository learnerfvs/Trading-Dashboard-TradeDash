// background.legacy.js — Firefox fallback background script
// This file provides a legacy background script entrypoint for Firefox where
// manifest v3 service workers may be disabled. It attempts to import the
// main `background.js` logic using importScripts (background page context)
// or falls back to fetching and evaluating the script.

/* global browser */
try {
    if (typeof importScripts === 'function') {
        // In a background page context, importScripts is available
        importScripts('background.js');
        console.log('Legacy background loader: imported background.js via importScripts');
    } else {
        // Fallback: try to load background.js by injecting a <script> element (CSP-friendly)
        (async function() {
            try {
                const url = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) ? browser.runtime.getURL('background.js') : (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('background.js') : 'background.js');

                // If we're in a document context, inject a script tag pointing at the extension resource
                if (typeof document !== 'undefined' && document.createElement) {
                    const script = document.createElement('script');
                    script.src = url;
                    script.onload = () => console.log('Legacy background loader: script tag loaded background.js');
                    script.onerror = (err) => console.error('Legacy background loader: failed loading background.js via script tag', err);
                    (document.head || document.documentElement).appendChild(script);
                    return;
                }

                // As a last resort (no document), fetch and create a blob URL and load via script tag
                const resp = await fetch(url);
                const code = await resp.text();
                const blob = new Blob([code], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                // In worker contexts there is no document, so try importScripts with blob URL
                try {
                    if (typeof importScripts === 'function') {
                        importScripts(blobUrl);
                        console.log('Legacy background loader: imported blob URL via importScripts');
                        URL.revokeObjectURL(blobUrl);
                        return;
                    }
                } catch (e) {
                    // ignore and continue to script tag approach
                }

                // If document becomes available later, inject script tag with blob
                if (typeof document !== 'undefined' && document.createElement) {
                    const s = document.createElement('script');
                    s.src = blobUrl;
                    s.onload = () => { console.log('Legacy background loader: loaded background.js via blob script'); URL.revokeObjectURL(blobUrl); };
                    s.onerror = (err) => { console.error('Legacy background loader: failed loading blob script', err); URL.revokeObjectURL(blobUrl); };
                    (document.head || document.documentElement).appendChild(s);
                    return;
                }

                console.error('Legacy background loader: unable to inject script for background.js (no document and importScripts failed)');
            } catch (e) {
                console.error('Failed to load background.js via script-tag/blob fallback', e);
            }
        })();
    }
} catch (err) {
    console.error('Error initializing legacy background loader', err);
}