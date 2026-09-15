package com.mangatrad.app;

import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import java.io.OutputStream;

/**
 * Coquille native : affiche l'app web MangaTrad dans une WebView.
 *
 * Les fichiers de l'app (assets/www) sont servis via {@link WebViewAssetLoader}
 * sur un domaine virtuel https (appassets.androidplatform.net). C'est indispensable
 * pour que les modules ES (import/export) et le Service Worker fonctionnent : sur
 * un origin file://, la WebView bloque les modules et refuse d'enregistrer un SW.
 *
 * Deux ponts natifs rendent l'app pleinement utilisable hors navigateur :
 *   - onShowFileChooser : ouvre le sélecteur système pour importer images / ZIP ;
 *   - AndroidBridge.saveBase64 : enregistre le ZIP/PNG de sortie dans « Téléchargements »
 *     (les téléchargements blob: ne déclenchent pas le DownloadListener d'une WebView).
 */
public class MainActivity extends AppCompatActivity {

    private static final String APP_URL =
            "https://appassets.androidplatform.net/www/index.html";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Tout est servi via le domaine virtuel https : pas d'accès file:// nécessaire.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "image/*", "application/zip", "application/x-zip-compressed", "multipart/x-zip"
                });
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, getString(R.string.file_chooser_title)),
                            FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Route aussi les requêtes du Service Worker à travers l'asset loader.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat swController = ServiceWorkerControllerCompat.getInstance();
            swController.setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return assetLoader.shouldInterceptRequest(request.getUrl());
                }
            });
        }

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) {
            return;
        }

        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    /** Pont exposé au JavaScript pour enregistrer un fichier dans « Téléchargements ». */
    private class AndroidBridge {
        @JavascriptInterface
        public void saveBase64(String filename, String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                saveToDownloads(safeName(filename), mime, bytes);
                toast("Enregistré dans Téléchargements : " + filename);
            } catch (Exception e) {
                toast("Échec de l'enregistrement : " + e.getMessage());
            }
        }
    }

    private void saveToDownloads(String filename, String mime, byte[] bytes) throws Exception {
        String type = (mime != null && !mime.isEmpty()) ? mime : "application/octet-stream";
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, type);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri item = getContentResolver().insert(collection, values);
        if (item == null) {
            throw new Exception("URI de destination indisponible");
        }
        try (OutputStream os = getContentResolver().openOutputStream(item)) {
            if (os == null) {
                throw new Exception("flux de sortie indisponible");
            }
            os.write(bytes);
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(item, values, null, null);
    }

    private static String safeName(String name) {
        String cleaned = (name == null || name.trim().isEmpty()) ? "mangatrad.bin" : name.trim();
        return cleaned.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
    }
}
