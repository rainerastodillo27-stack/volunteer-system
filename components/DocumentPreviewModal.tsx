import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getAttachmentLabel, isImageMediaUri } from '../utils/media';

type DocumentPreviewModalProps = {
  visible: boolean;
  uri?: string | null;
  title?: string;
  onClose: () => void;
};

// Keeps identity documents inside the app. It intentionally exposes no download
// or external-open action: administrators can inspect the submitted image only.
export default function DocumentPreviewModal({
  visible,
  uri,
  title = 'Document Preview',
  onClose,
}: DocumentPreviewModalProps) {
  const normalizedUri = typeof uri === 'string' ? uri.trim() : '';
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [normalizedUri, visible]);

  const canPreviewImage = Boolean(normalizedUri) && isImageMediaUri(normalizedUri) && !imageFailed;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
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
              <MaterialIcons name="close" size={22} color="#475569" />
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
            ) : (
              <View style={styles.unavailableState}>
                <MaterialIcons name="broken-image" size={42} color="#94a3b8" />
                <Text style={styles.unavailableTitle}>Preview unavailable</Text>
                <Text style={styles.unavailableText}>
                  This submitted document is not an image that can be previewed in the app.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <MaterialIcons name="visibility" size={16} color="#166534" />
            <Text style={styles.footerText}>Preview only</Text>
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
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
  footerText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
});
