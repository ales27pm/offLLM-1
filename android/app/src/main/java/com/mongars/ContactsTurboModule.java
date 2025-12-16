package com.mongars;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.module.annotations.ReactModule;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * ContactsTurboModule provides basic contact lookup and insertion on
 * Android devices. The implementation makes use of the Contacts
 * Provider to perform queries and modifications. Caller must ensure
 * that READ_CONTACTS and WRITE_CONTACTS permissions have been granted.
 */
@ReactModule(name = ContactsTurboModule.NAME)
public class ContactsTurboModule extends ReactContextBaseJavaModule {
    public static final String NAME = "ContactsTurboModule";

    public ContactsTurboModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void findContact(String query, Promise promise) {
        ReactApplicationContext ctx = getReactApplicationContext();
        if (!ModuleUtils.hasPermission(ctx, Manifest.permission.READ_CONTACTS)) {
            promise.reject("permission_denied", "Contacts access denied");
            return;
        }
        ContentResolver cr = ctx.getContentResolver();
        WritableArray results = new WritableNativeArray();
        try (Cursor contacts = cr.query(
                ContactsContract.Contacts.CONTENT_URI,
                new String[]{ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME},
                ContactsContract.Contacts.DISPLAY_NAME + " LIKE ?",
                new String[]{"%" + query + "%"},
                null)) {
            if (contacts != null) {
                while (contacts.moveToNext()) {
                    String id = contacts.getString(0);
                    String name = contacts.getString(1);
                    List<String> phones = queryStrings(cr, ContactsContract.CommonDataKinds.Phone.CONTENT_URI, id, ContactsContract.CommonDataKinds.Phone.NUMBER);
                    List<String> emails = queryStrings(cr, ContactsContract.CommonDataKinds.Email.CONTENT_URI, id, ContactsContract.CommonDataKinds.Email.ADDRESS);
                    results.pushMap(buildContactMap(name, phones, emails));
                }
            }
            promise.resolve(results);
        } catch (SecurityException se) {
            ModuleUtils.rejectWithException(promise, "permission_denied", se);
        } catch (Exception e) {
            ModuleUtils.rejectWithException(promise, "search_error", e);
        }
    }

    @ReactMethod
    public void addContact(String name, String phone, String email, Promise promise) {
        if (name == null || name.trim().isEmpty()) {
            promise.reject("invalid_name", "Name is required");
            return;
        }
        ReactApplicationContext ctx = getReactApplicationContext();
        if (!ModuleUtils.hasPermission(ctx, Manifest.permission.WRITE_CONTACTS)) {
            promise.reject("permission_denied", "Contacts access denied");
            return;
        }
        try {
            NameParts np = parseName(name);
            ArrayList<ContentProviderOperation> ops = new ArrayList<>();
            ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                    .build());
            ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                    .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                    .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME, np.given)
                    .withValue(ContactsContract.CommonDataKinds.StructuredName.MIDDLE_NAME, np.middle)
                    .withValue(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME, np.family)
                    .build());
            if (phone != null && !phone.isEmpty()) {
                ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                        .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, phone)
                        .withValue(ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
                        .build());
            }
            if (email != null && !email.isEmpty()) {
                ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                        .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                        .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE)
                        .withValue(ContactsContract.CommonDataKinds.Email.ADDRESS, email)
                        .withValue(ContactsContract.CommonDataKinds.Email.TYPE, ContactsContract.CommonDataKinds.Email.TYPE_HOME)
                        .build());
            }
            ctx.getContentResolver().applyBatch(ContactsContract.AUTHORITY, ops);
            WritableMap res = new WritableNativeMap();
            res.putBoolean("success", true);
            promise.resolve(res);
        } catch (SecurityException se) {
            ModuleUtils.rejectWithException(promise, "permission_denied", se);
        } catch (Exception e) {
            ModuleUtils.rejectWithException(promise, "save_error", e);
        }
    }

    private List<String> queryStrings(ContentResolver cr, Uri uri, String contactId, String column) {
        List<String> out = new ArrayList<>();
        try (Cursor c = cr.query(uri, new String[]{column}, ContactsContract.Data.CONTACT_ID + "=?", new String[]{contactId}, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    out.add(c.getString(0));
                }
            }
        }
        return out;
    }

    private WritableArray toWritableArray(List<String> list) {
        WritableArray arr = new WritableNativeArray();
        for (String s : list) {
            arr.pushString(s);
        }
        return arr;
    }

    private WritableMap buildContactMap(String name, List<String> phones, List<String> emails) {
        WritableMap map = new WritableNativeMap();
        map.putString("name", name == null ? "" : name);
        map.putArray("phones", toWritableArray(phones));
        map.putArray("emails", toWritableArray(emails));
        return map;
    }

    private static class NameParts {
        String given;
        String middle;
        String family;
    }

    private NameParts parseName(String fullName) {
        NameParts np = new NameParts();
        if (fullName == null) return np;
        String[] parts = fullName.trim().split("\\s+");
        if (parts.length > 0) np.given = parts[0];
        if (parts.length > 1) np.family = parts[parts.length - 1];
        if (parts.length > 2) {
            np.middle = String.join(" ", Arrays.copyOfRange(parts, 1, parts.length - 1));
        }
        return np;
    }
}
