package io.clipvault.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClipVaultNativePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        getWindow().getDecorView().setBackgroundColor(Color.TRANSPARENT);
        ViewGroup content = findViewById(android.R.id.content);
        if (content != null) {
            content.setBackgroundColor(Color.TRANSPARENT);
            if (content.getChildCount() > 0) {
                content.getChildAt(0).setBackgroundColor(Color.TRANSPARENT);
            }
        }
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
            getBridge().getWebView().setLayerType(View.LAYER_TYPE_HARDWARE, null);
        }
    }
}
