import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Partner } from '../models/types';
import { getAllPartners, savePartner } from '../models/storage';
import { useAuth } from '../contexts/AuthContext';

export default function PartnerOnboardingScreen({ navigation }: any) {
  const { user, isAdmin } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [orgEmail, setOrgEmail] = useState(user?.email ?? '');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [category, setCategory] = useState<'Education' | 'Livelihood' | 'Nutrition' | 'Other'>('Other');

  useEffect(() => {
    loadPartners();
  }, [filter, isAdmin, user?.email]);

  const loadPartners = async () => {
    try {
      const allPartners = await getAllPartners();
      if (isAdmin) {
        if (filter === 'All') {
          setPartners(allPartners);
        } else {
          setPartners(allPartners.filter(p => p.status === filter));
        }
        return;
      }

      const ownPartners = allPartners.filter(
        p => p.contactEmail.toLowerCase() === user?.email?.toLowerCase()
      );
      setPartners(ownPartners);
    } catch (error) {
      Alert.alert('Error', 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (partnerId: string) => {
    try {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;

      partner.status = 'Approved';
      partner.validatedBy = user?.id;
      partner.validatedAt = new Date().toISOString();

      await savePartner(partner);
      Alert.alert('Success', `${partner.name} has been approved`);
      loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to approve partner');
    }
  };

  const handleReject = async (partnerId: string) => {
    try {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;

      partner.status = 'Rejected';
      partner.validatedBy = user?.id;
      partner.validatedAt = new Date().toISOString();

      await savePartner(partner);
      Alert.alert('Success', `${partner.name} has been rejected`);
      loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to reject partner');
    }
  };

  const renderPartnerCard = (partner: Partner) => {
    const getStatusColor = (status: string) => {
      switch (status) {
        case 'Approved':
          return '#4CAF50';
        case 'Pending':
          return '#FFA500';
        case 'Rejected':
          return '#f44336';
        default:
          return '#999';
      }
    };

    return (
      <View key={partner.id} style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>{partner.name}</Text>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{partner.category}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(partner.status) }]}>
            <Text style={styles.statusText}>{partner.status}</Text>
          </View>
        </View>

        <Text style={styles.description}>{partner.description}</Text>

        <View style={styles.contactInfo}>
          <View style={styles.contactRow}>
            <MaterialIcons name="email" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.contactEmail}</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialIcons name="phone" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.contactPhone}</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialIcons name="location-on" size={16} color="#666" />
            <Text style={styles.contactText}>{partner.address}</Text>
          </View>
        </View>

        {isAdmin && partner.status === 'Pending' && (
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.button, styles.approveButton]}
              onPress={() => handleApprove(partner.id)}
            >
              <MaterialIcons name="check-circle" size={20} color="#fff" />
              <Text style={styles.buttonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={() => handleReject(partner.id)}
            >
              <MaterialIcons name="cancel" size={20} color="#fff" />
              <Text style={styles.buttonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const handleSubmitPartner = async () => {
    if (
      !orgName.trim() ||
      !orgDescription.trim() ||
      !orgEmail.trim() ||
      !orgPhone.trim() ||
      !orgAddress.trim()
    ) {
      Alert.alert('Validation Error', 'Please fill all partner program fields.');
      return;
    }

    try {
      const newPartner: Partner = {
        id: `partner-${Date.now()}`,
        name: orgName.trim(),
        description: orgDescription.trim(),
        category,
        contactEmail: orgEmail.trim().toLowerCase(),
        contactPhone: orgPhone.trim(),
        address: orgAddress.trim(),
        status: 'Pending',
        createdAt: new Date().toISOString(),
      };

      await savePartner(newPartner);
      setOrgName('');
      setOrgDescription('');
      setOrgEmail(user?.email ?? '');
      setOrgPhone('');
      setOrgAddress('');
      setCategory('Other');
      Alert.alert('Submitted', 'Program onboarding request sent for admin approval.');
      loadPartners();
    } catch (error) {
      Alert.alert('Error', 'Failed to submit program.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Partner Onboarding</Text>

      {user?.role === 'partner' && (
        <View style={styles.submissionCard}>
          <Text style={styles.submissionTitle}>Submit Program / Organization</Text>
          <TextInput
            style={styles.input}
            placeholder="Program or Organization Name"
            value={orgName}
            onChangeText={setOrgName}
          />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Description / Focus area"
            value={orgDescription}
            onChangeText={setOrgDescription}
            multiline
          />
          <View style={styles.chipRow}>
            {(['Education', 'Livelihood', 'Nutrition', 'Other'] as const).map(option => (
              <TouchableOpacity
                key={option}
                style={[styles.chip, category === option && styles.chipActive]}
                onPress={() => setCategory(option)}
              >
                <Text
                  style={[styles.chipText, category === option && styles.chipTextActive]}
                >
                  {option}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Contact Email"
            value={orgEmail}
            onChangeText={setOrgEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Contact Phone"
            value={orgPhone}
            onChangeText={setOrgPhone}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Address / City"
            value={orgAddress}
            onChangeText={setOrgAddress}
          />
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmitPartner}>
            <Text style={styles.submitButtonText}>Submit for Approval</Text>
          </TouchableOpacity>
        </View>
      )}

      {isAdmin && (
        <View style={styles.filterContainer}>
          {(['All', 'Pending', 'Approved', 'Rejected'] as const).map(status => (
            <TouchableOpacity
              key={status}
              style={[styles.filterButton, filter === status && styles.filterButtonActive]}
              onPress={() => setFilter(status)}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  filter === status && styles.filterButtonTextActive,
                ]}
              >
                {status}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {partners.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialIcons name="business" size={48} color="#ccc" />
          <Text style={styles.emptyText}>
            {isAdmin ? 'No partners found' : 'Partners are visible to admins only'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {partners.map(renderPartnerCard)}
        </View>
      )}

      {isAdmin && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => Alert.alert('Info', 'Use the partner onboarding workflow on this screen.')}
        >
          <MaterialIcons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  submissionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  submissionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: '#fff',
    color: '#333',
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
  },
  chipActive: {
    backgroundColor: '#4CAF50',
  },
  chipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
  },
  filterButtonActive: {
    backgroundColor: '#4CAF50',
  },
  filterButtonText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  categoryBadge: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  categoryText: {
    color: '#2E7D32',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  description: {
    color: '#666',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  contactInfo: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactText: {
    color: '#666',
    fontSize: 13,
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  approveButton: {
    backgroundColor: '#4CAF50',
  },
  rejectButton: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    marginBottom: 80,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
