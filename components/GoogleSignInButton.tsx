import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useIdTokenAuthRequest } from "expo-auth-session/providers/google";

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "";
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";

function getGoogleClientId(): string {
  if (Platform.OS === "android") return GOOGLE_ANDROID_CLIENT_ID;
  if (Platform.OS === "ios") return GOOGLE_IOS_CLIENT_ID;
  return GOOGLE_WEB_CLIENT_ID;
}

export const googleSignInConfigured = Boolean(getGoogleClientId());

type GoogleSignInButtonProps = {
  disabled?: boolean;
  onToken: (idToken: string) => void | Promise<void>;
  onError: (error: unknown) => void;
};

type ButtonProps = {
  disabled?: boolean;
  label?: string;
  onPress: () => void | Promise<void>;
  busy?: boolean;
};

function GoogleButton({ disabled, busy, label = "Sign in with Google", onPress }: ButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.button, (disabled || busy) && styles.buttonDisabled]}
      onPress={() => void onPress()}
      disabled={disabled || busy}
      activeOpacity={0.86}
    >
      <View style={styles.googleMark}>
        <Text style={styles.googleMarkText}>G</Text>
      </View>
      {busy ? (
        <ActivityIndicator color="#0f172a" size="small" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function ConfiguredGoogleSignInButton({ disabled, onError, onToken }: GoogleSignInButtonProps) {
  const [busy, setBusy] = useState(false);
  const handledTokenRef = useRef<string | null>(null);
  const handledResponseRef = useRef<unknown>(null);
  const clientId = getGoogleClientId();
  const [request, response, promptAsync] = useIdTokenAuthRequest({
    clientId,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    selectAccount: true,
  });

  useEffect(() => {
    if (!response || handledResponseRef.current === response) return;
    handledResponseRef.current = response;

    if (response.type === "error") {
      setBusy(false);
      onError(response.error || new Error("Google sign-in was not completed."));
      return;
    }

    if (response.type !== "success") {
      setBusy(false);
      return;
    }

    const idToken = response.params?.id_token || response.authentication?.idToken || "";
    if (!idToken || handledTokenRef.current === idToken) {
      if (!idToken) {
        setBusy(false);
        onError(new Error("Google sign-in did not return an identity token."));
      }
      return;
    }

    handledTokenRef.current = idToken;
    void Promise.resolve(onToken(idToken))
      .catch((error) => onError(error))
      .finally(() => setBusy(false));
  }, [onError, onToken, response]);

  const handlePress = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await promptAsync();
    } catch (error) {
      setBusy(false);
      onError(error);
    }
  };

  return (
    <GoogleButton
      busy={busy}
      disabled={disabled || !request}
      onPress={handlePress}
    />
  );
}

function UnconfiguredGoogleSignInButton({ onError, ...props }: GoogleSignInButtonProps) {
  return (
    <GoogleButton
      {...props}
      onPress={() => onError(new Error("Google OAuth is not configured for this build."))}
    />
  );
}

export default function GoogleSignInButton(props: GoogleSignInButtonProps) {
  if (!googleSignInConfigured) {
    return <UnconfiguredGoogleSignInButton {...props} />;
  }

  return <ConfiguredGoogleSignInButton {...props} />;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Nunito",
  },
  googleMark: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  googleMarkText: {
    color: "#4285f4",
    fontSize: 20,
    fontWeight: "800",
    fontFamily: "Nunito",
  },
});
