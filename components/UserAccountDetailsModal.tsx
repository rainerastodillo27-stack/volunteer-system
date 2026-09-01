import React from 'react';
import { View, Text, Modal, TouchableOpacity, Image, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getAttachmentLabel, isImageMediaUri, openAttachmentUri } from '../utils/media';

// Props: visible, onClose, user (User | null)
export default function UserAccountDetailsModal({ visible, onClose, user }: { visible: boolean; onClose: () => void; user: any }) {
  if (!user) return null;

  const validIdPhoto = user?.volunteerMembershipSheet?.validIdPhoto || user?.validIdPhoto || '';
  const documents = user?.partnerRegistration?.registrationDocuments || [];

  return (
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
                  onPress={async () => {
                    try { await openAttachmentUri(validIdPhoto); } catch (_) {}
                  }}
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
                    onPress={async () => { try { await openAttachmentUri(uri); } catch (_) {} }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                  >
                    <MaterialIcons name="insert-drive-file" size={20} color="#166534" />
                    <Text style={{ marginLeft: 8, color: '#166534' }}>{isImageMediaUri(uri) ? getAttachmentLabel(uri) : uri}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

