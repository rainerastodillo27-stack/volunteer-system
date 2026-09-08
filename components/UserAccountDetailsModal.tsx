import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, Image, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getAttachmentLabel } from '../utils/media';
import DocumentPreviewModal from './DocumentPreviewModal';

// Props: visible, onClose, user (User | null), volunteer profile when available.
export default function UserAccountDetailsModal({
  visible,
  onClose,
  user,
  volunteer,
}: {
  visible: boolean;
  onClose: () => void;
  user: any;
  volunteer?: { validIdPhoto?: string } | null;
}) {
  const [documentPreview, setDocumentPreview] = useState<{ title: string; uri: string } | null>(null);

  if (!user) return null;

  const validIdPhoto = volunteer?.validIdPhoto || user?.volunteerMembershipSheet?.validIdPhoto || user?.validIdPhoto || '';
  const documents = user?.partnerRegistration?.registrationDocuments || [];

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, maxHeight: '90%', padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '600' }}>Account Details</Text>
            <TouchableOpacity onPress={onClose}>
              <MaterialIcons name="close" size={24} color="#555" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ marginTop: 12 }}>
            {validIdPhoto ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontWeight: '500', marginBottom: 4 }}>Valid ID Photo</Text>
                <TouchableOpacity
                  onPress={() => setDocumentPreview({ title: 'Valid ID Preview', uri: validIdPhoto })}
                  style={{ padding: 4, backgroundColor: '#f0fdf4', borderRadius: 6 }}
                >
                  <Image source={{ uri: validIdPhoto }} style={{ width: '100%', height: 180, borderRadius: 8, resizeMode: 'contain' }} />
                </TouchableOpacity>
              </View>
            ) : null}
            {documents.length > 0 ? (
              <View>
                <Text style={{ fontWeight: '500', marginBottom: 4 }}>Registration Documents</Text>
                {documents.map((uri: string, idx: number) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => setDocumentPreview({ title: 'Registration Document Preview', uri })}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                  >
                    <MaterialIcons name="insert-drive-file" size={20} color="#166534" />
                    <Text style={{ marginLeft: 8, color: '#166534' }}>{getAttachmentLabel(uri)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
      </Modal>
      <DocumentPreviewModal
        visible={Boolean(documentPreview)}
        title={documentPreview?.title}
        uri={documentPreview?.uri}
        onClose={() => setDocumentPreview(null)}
      />
    </>
  );
}
