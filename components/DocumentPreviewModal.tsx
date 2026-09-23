import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAttachmentLabel, isImageMediaUri } from '../utils/media';
import { GLOBAL_FONT_FAMILY } from '../utils/fonts';

type DocumentPreviewModalProps = {
  visible: boolean;
  uri?: string | null;
  title?: string;
  onClose: () => void;
  allowExternalOpen?: boolean;
  onOpenExternal?: () => void;
};

const TEXT_FILE_PATTERN = /\.(csv|txt|json|xml|log|md)(?:[?#]|$)/i;

function isTextDocumentUri(uri: string): boolean {
  const dataMime = uri.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();
  if (dataMime) {
    return dataMime.startsWith('text/') || dataMime.includes('csv') || dataMime.includes('json') || dataMime.includes('xml');
  }
  return TEXT_FILE_PATTERN.test(uri);
}

function decodeDataUri(uri: string): string {
  const separatorIndex = uri.indexOf(',');
  if (separatorIndex < 0) return '';
  const metadata = uri.slice(0, separatorIndex);
  const payload = uri.slice(separatorIndex + 1);
  if (/;base64/i.test(metadata)) {
    return typeof atob === 'function' ? atob(payload) : payload;
  }
  return decodeURIComponent(payload);
}

export default function DocumentPreviewModal({
  visible,
  uri,
  title = 'Document Preview',
  onClose,
  allowExternalOpen = false,
  onOpenExternal,
}: DocumentPreviewModalProps) {
  const insets = useSafeAreaInsets();
  const normalizedUri = typeof uri === 'string' ? uri.trim() : '';
  const [imageFailed, setImageFailed] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setTextContent(null);
    setTextError(false);

    if (!visible || !normalizedUri || !isTextDocumentUri(normalizedUri)) {
      setTextLoading(false);
      return;
    }

    let active = true;
    setTextLoading(true);

    const loadText = async () => {
      try {
        const content = normalizedUri.startsWith('data:')
          ? decodeDataUri(normalizedUri)
          : Platform.OS === 'web' && typeof fetch === 'function'
            ? await (await fetch(normalizedUri)).text()
            : '';

        if (active) {
          setTextContent(content);
          setTextError(!content);
        }
      } catch {
        if (active) setTextError(true);
      } finally {
        if (active) setTextLoading(false);
      }
    };

    void loadText();
    return () => {
      active = false;
    };
  }, [normalizedUri, visible]);

  const canPreviewImage = Boolean(normalizedUri) && isImageMediaUri(normalizedUri) && !imageFailed;
  const isTextDocument = Boolean(normalizedUri) && isTextDocumentUri(normalizedUri);
  const canEmbedDocument = Boolean(normalizedUri) && !canPreviewImage && !isTextDocument;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.fileName} numberOfLines={1}>
                {getAttachmentLabel(normalizedUri)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close document preview"
            >
              <MaterialIcons name="close" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <View style={styles.previewFrame}>
            {canPreviewImage ? (
              <Image
                source={{ uri: normalizedUri }}
                style={styles.previewImage}
                resizeMode="contain"
                onError={() => setImageFailed(true)}
                accessibilityLabel={title}
              />
            ) : isTextDocument && textLoading ? (
              <View style={styles.unavailableState}>
                <MaterialIcons name="hourglass-empty" size={42} color="#166534" />
                <Text style={styles.unavailableTitle}>Loading preview…</Text>
              </View>
            ) : isTextDocument && textContent !== null && !textError ? (
              <ScrollView style={styles.textPreview} contentContainerStyle={styles.textPreviewContent}>
                <Text style={styles.textPreviewValue}>{textContent}</Text>
              </ScrollView>
            ) : canEmbedDocument && Platform.OS === 'web' ? (
              <View style={styles.embeddedPreview}>
                {React.createElement('iframe', {
                  src: normalizedUri,
                  title,
                  style: { width: '100%', height: '100%', border: '0' },
                })}
              </View>
            ) : canEmbedDocument && Platform.OS !== 'web' ? (
              <WebView
                source={{ uri: normalizedUri }}
                style={styles.previewWebView}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
              />
            ) : (
              <View style={styles.unavailableState}>
                <MaterialIcons name="description" size={42} color="#94a3b8" />
                <Text style={styles.unavailableTitle}>Preview unavailable</Text>
                <Text style={styles.unavailableText}>
                  This attachment could not be rendered in the preview.
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.footer, allowExternalOpen && styles.footerWithAction]}>
            <View style={styles.footerLabel}>
              <MaterialIcons name="visibility" size={16} color="#166534" />
              <Text style={styles.footerText}>Preview first</Text>
            </View>
            {allowExternalOpen && onOpenExternal ? (
              <TouchableOpacity style={styles.openButton} onPress={onOpenExternal} activeOpacity={0.85}>
                <MaterialIcons name="open-in-new" size={15} color="#ffffff" />
                <Text style={styles.openButtonText}>Open original</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.66)',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '92%',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '800',
  },
  fileName: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  previewFrame: {
    minHeight: 260,
    height: 460,
    maxHeight: '72%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  embeddedPreview: {
    width: '100%',
    height: '100%',
  },
  previewWebView: {
    flex: 1,
    width: '100%',
    backgroundColor: '#ffffff',
  },
  textPreview: {
    width: '100%',
    height: '100%',
  },
  textPreviewContent: {
    padding: 18,
  },
  textPreviewValue: {
    color: '#1e293b',
    fontFamily: GLOBAL_FONT_FAMILY,
    fontSize: 12,
    lineHeight: 18,
  },
  unavailableState: {
    maxWidth: 360,
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  unavailableTitle: {
    marginTop: 12,
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
  },
  unavailableText: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#f0fdf4',
  },
  footerWithAction: {
    justifyContent: 'space-between',
  },
  footerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#166534',
  },
  openButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
});
