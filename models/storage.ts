import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  User,
  Partner,
  Project,
  Volunteer,
  Message,
  ImpactReport,
  StatusUpdate,
  VolunteerProjectMatch,
  PartnerDonation,
  SectorNeed,
  NVCSector,
} from './types';

const STORAGE_KEYS = {
  USERS: 'users',
  CURRENT_USER: 'currentUser',
  PARTNERS: 'partners',
  PROJECTS: 'projects',
  VOLUNTEERS: 'volunteers',
  MESSAGES: 'messages',
  IMPACT_REPORTS: 'impactReports',
  STATUS_UPDATES: 'statusUpdates',
  VOLUNTEER_MATCHES: 'volunteerMatches',
  DONATIONS: 'donations',
};

const WEB_MESSAGE_SYNC_KEY = 'volunteer-system:messages:updatedAt';
const SECTOR_NEEDS: SectorNeed[] = [
  {
    sector: 'Education',
    title: 'NVC Education Sector',
    description: 'Learning materials, school equipment, and classroom support.',
    goalAmount: 500000,
  },
  {
    sector: 'Livelihood',
    title: 'NVC Livelihood Sector',
    description: 'Skills training tools, starter kits, and income-generation support.',
    goalAmount: 400000,
  },
  {
    sector: 'Nutrition',
    title: 'NVC Nutrition Sector',
    description: 'Nutrition packs, feeding programs, and health monitoring.',
    goalAmount: 300000,
  },
];

function notifyWebMessageUpdate(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(WEB_MESSAGE_SYNC_KEY, String(Date.now()));
  }
}

// Generic storage functions
export async function getStorageItem<T>(key: string): Promise<T | null> {
  try {
    const item = await AsyncStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error(`Error reading ${key}:`, error);
    return null;
  }
}

export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving ${key}:`, error);
  }
}

// User Storage
export async function saveUser(user: User): Promise<void> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  const existingIndex = users.findIndex(u => u.id === user.id);
  if (existingIndex >= 0) {
    users[existingIndex] = user;
  } else {
    users.push(user);
  }
  await setStorageItem(STORAGE_KEYS.USERS, users);
}

export async function getUser(id: string): Promise<User | null> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.id === id) || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getStorageItem<User[]>(STORAGE_KEYS.USERS) || [];
  return users.find(u => u.email === email) || null;
}

export async function getAllUsers(): Promise<User[]> {
  return (await getStorageItem<User[]>(STORAGE_KEYS.USERS)) || [];
}

export async function setCurrentUser(user: User | null): Promise<void> {
  if (user) {
    await setStorageItem(STORAGE_KEYS.CURRENT_USER, user);
  } else {
    await AsyncStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
}

export async function getCurrentUser(): Promise<User | null> {
  return (await getStorageItem<User>(STORAGE_KEYS.CURRENT_USER)) || null;
}

// Partner Storage
export async function savePartner(partner: Partner): Promise<void> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  const existingIndex = partners.findIndex(p => p.id === partner.id);
  if (existingIndex >= 0) {
    partners[existingIndex] = partner;
  } else {
    partners.push(partner);
  }
  await setStorageItem(STORAGE_KEYS.PARTNERS, partners);
}

export async function getPartner(id: string): Promise<Partner | null> {
  const partners = await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS) || [];
  return partners.find(p => p.id === id) || null;
}

export async function getAllPartners(): Promise<Partner[]> {
  return (await getStorageItem<Partner[]>(STORAGE_KEYS.PARTNERS)) || [];
}

export async function getPartnersByStatus(status: string): Promise<Partner[]> {
  const partners = await getAllPartners();
  return partners.filter(p => p.status === status);
}

// Project Storage
export async function saveProject(project: Project): Promise<void> {
  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  const existingIndex = projects.findIndex(p => p.id === project.id);
  if (existingIndex >= 0) {
    projects[existingIndex] = project;
  } else {
    projects.push(project);
  }
  await setStorageItem(STORAGE_KEYS.PROJECTS, projects);
}

export async function getProject(id: string): Promise<Project | null> {
  const projects = await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS) || [];
  return projects.find(p => p.id === id) || null;
}

export async function getAllProjects(): Promise<Project[]> {
  return (await getStorageItem<Project[]>(STORAGE_KEYS.PROJECTS)) || [];
}

export async function getProjectsByStatus(status: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.status === status);
}

export async function getProjectsByPartner(partnerId: string): Promise<Project[]> {
  const projects = await getAllProjects();
  return projects.filter(p => p.partnerId === partnerId);
}

// Volunteer Storage
export async function saveVolunteer(volunteer: Volunteer): Promise<void> {
  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  const existingIndex = volunteers.findIndex(v => v.id === volunteer.id);
  if (existingIndex >= 0) {
    volunteers[existingIndex] = volunteer;
  } else {
    volunteers.push(volunteer);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEERS, volunteers);
}

export async function getVolunteer(id: string): Promise<Volunteer | null> {
  const volunteers = await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS) || [];
  return volunteers.find(v => v.id === id) || null;
}

export async function getAllVolunteers(): Promise<Volunteer[]> {
  return (await getStorageItem<Volunteer[]>(STORAGE_KEYS.VOLUNTEERS)) || [];
}

// Message Storage
export async function saveMessage(message: Message): Promise<void> {
  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  messages.push(message);
  await setStorageItem(STORAGE_KEYS.MESSAGES, messages);
  notifyWebMessageUpdate();
}

export async function getMessagesForUser(userId: string): Promise<Message[]> {
  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  return messages.filter(
    m => m.recipientId === userId || m.senderId === userId
  ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function getConversation(userId1: string, userId2: string): Promise<Message[]> {
  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  return messages
    .filter(
      m =>
        (m.senderId === userId1 && m.recipientId === userId2) ||
        (m.senderId === userId2 && m.recipientId === userId1)
    )
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  const message = messages.find(m => m.id === messageId);
  if (message) {
    message.read = true;
    await setStorageItem(STORAGE_KEYS.MESSAGES, messages);
    notifyWebMessageUpdate();
  }
}

// Impact Report Storage
export async function saveImpactReport(report: ImpactReport): Promise<void> {
  const reports = await getStorageItem<ImpactReport[]>(STORAGE_KEYS.IMPACT_REPORTS) || [];
  const existingIndex = reports.findIndex(r => r.id === report.id);
  if (existingIndex >= 0) {
    reports[existingIndex] = report;
  } else {
    reports.push(report);
  }
  await setStorageItem(STORAGE_KEYS.IMPACT_REPORTS, reports);
}

export async function getImpactReport(id: string): Promise<ImpactReport | null> {
  const reports = await getStorageItem<ImpactReport[]>(STORAGE_KEYS.IMPACT_REPORTS) || [];
  return reports.find(r => r.id === id) || null;
}

export async function getImpactReportsByProject(projectId: string): Promise<ImpactReport[]> {
  const reports = await getStorageItem<ImpactReport[]>(STORAGE_KEYS.IMPACT_REPORTS) || [];
  return reports.filter(r => r.projectId === projectId);
}

// Status Update Storage
export async function saveStatusUpdate(update: StatusUpdate): Promise<void> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  updates.push(update);
  await setStorageItem(STORAGE_KEYS.STATUS_UPDATES, updates);
}

export async function getStatusUpdatesByProject(projectId: string): Promise<StatusUpdate[]> {
  const updates = await getStorageItem<StatusUpdate[]>(STORAGE_KEYS.STATUS_UPDATES) || [];
  return updates
    .filter(u => u.projectId === projectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// Volunteer Project Match Storage
export async function saveVolunteerProjectMatch(match: VolunteerProjectMatch): Promise<void> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  const existingIndex = matches.findIndex(m => m.id === match.id);
  if (existingIndex >= 0) {
    matches[existingIndex] = match;
  } else {
    matches.push(match);
  }
  await setStorageItem(STORAGE_KEYS.VOLUNTEER_MATCHES, matches);
}

export async function getVolunteerProjectMatches(volunteerId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches.filter(m => m.volunteerId === volunteerId);
}

export async function getProjectMatches(projectId: string): Promise<VolunteerProjectMatch[]> {
  const matches = await getStorageItem<VolunteerProjectMatch[]>(STORAGE_KEYS.VOLUNTEER_MATCHES) || [];
  return matches.filter(m => m.projectId === projectId);
}

// Donation Storage
export async function getSectorNeeds(): Promise<SectorNeed[]> {
  return SECTOR_NEEDS;
}

export async function saveDonation(donation: PartnerDonation): Promise<void> {
  const donations = await getStorageItem<PartnerDonation[]>(STORAGE_KEYS.DONATIONS) || [];
  donations.push(donation);
  await setStorageItem(STORAGE_KEYS.DONATIONS, donations);
}

export async function getAllDonations(): Promise<PartnerDonation[]> {
  return (await getStorageItem<PartnerDonation[]>(STORAGE_KEYS.DONATIONS)) || [];
}

export async function getDonationsByPartnerUser(partnerUserId: string): Promise<PartnerDonation[]> {
  const donations = await getAllDonations();
  return donations
    .filter(d => d.partnerUserId === partnerUserId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getSectorDonationTotals(): Promise<Record<NVCSector, number>> {
  const totals: Record<NVCSector, number> = {
    Education: 0,
    Livelihood: 0,
    Nutrition: 0,
  };

  const donations = await getAllDonations();
  for (const donation of donations) {
    totals[donation.sector] += donation.amount;
  }
  return totals;
}

// Clear all storage (for testing/logout)
export async function clearAllStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
}

// Initialize with mock data
export async function initializeMockData(): Promise<void> {
  const existingUsers = await getAllUsers();
  if (existingUsers.length > 0) {
    await ensurePartnerUser();
    await ensureAdminVolunteerConversation();
    return; // Data already initialized
  }

  // Create mock admin and volunteer users
  const admin: User = {
    id: 'admin-1',
    email: 'admin@nvc.org',
    password: 'admin123',
    role: 'admin',
    name: 'Admin User',
    phone: '+1234567890',
    createdAt: new Date().toISOString(),
  };

  const volunteer: User = {
    id: 'volunteer-1',
    email: 'volunteer@example.com',
    password: 'volunteer123',
    role: 'volunteer',
    name: 'John Volunteer',
    phone: '+0987654321',
    createdAt: new Date().toISOString(),
  };

  const partnerUser: User = {
    id: 'partner-user-1',
    email: 'partner@livelihoods.org',
    password: 'partner123',
    role: 'partner',
    name: 'Partner Organization User',
    phone: '+919876543211',
    createdAt: new Date().toISOString(),
  };

  await saveUser(admin);
  await saveUser(volunteer);
  await saveUser(partnerUser);

  // Mock partners
  const partners: Partner[] = [
    {
      id: 'partner-1',
      name: 'Education India Foundation',
      description: 'Focused on quality education',
      category: 'Education',
      contactEmail: 'contact@eduindia.org',
      contactPhone: '+919876543210',
      address: 'Mumbai, India',
      status: 'Approved',
      validatedBy: 'admin-1',
      validatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'partner-2',
      name: 'Livelihood Skills NGO',
      description: 'Providing vocational training',
      category: 'Livelihood',
      contactEmail: 'contact@livelihoods.org',
      contactPhone: '+919876543211',
      address: 'Bangalore, India',
      status: 'Pending',
      createdAt: new Date().toISOString(),
    },
  ];

  for (const partner of partners) {
    await savePartner(partner);
  }

  // Mock projects
  const projects: Project[] = [
    {
      id: 'project-1',
      title: 'Rural School Library Setup',
      description: 'Setting up modern library infrastructure in rural schools',
      partnerId: 'partner-1',
      status: 'In Progress',
      category: 'Education',
      startDate: new Date(2026, 0, 15).toISOString(),
      endDate: new Date(2026, 5, 15).toISOString(),
      location: {
        latitude: 19.0760,
        longitude: 72.8777,
        address: 'Mumbai Rural Area',
      },
      volunteersNeeded: 10,
      volunteers: ['volunteer-1'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusUpdates: [],
    },
    {
      id: 'project-2',
      title: 'Vocational Training Program',
      description: 'Textile and handicraft skill development',
      partnerId: 'partner-2',
      status: 'Planning',
      category: 'Livelihood',
      startDate: new Date(2026, 2, 1).toISOString(),
      endDate: new Date(2026, 7, 31).toISOString(),
      location: {
        latitude: 12.9716,
        longitude: 77.5946,
        address: 'Bangalore, India',
      },
      volunteersNeeded: 5,
      volunteers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusUpdates: [],
    },
  ];

  for (const project of projects) {
    await saveProject(project);
  }

  // Mock volunteer profile
  const volunteerProfile: Volunteer = {
    id: 'volunteer-1',
    userId: 'volunteer-1',
    name: 'John Volunteer',
    email: 'volunteer@example.com',
    phone: '+0987654321',
    skills: ['Teaching', 'Mentoring', 'Community Outreach'],
    availability: {
      daysPerWeek: 3,
      hoursPerWeek: 12,
      availableDays: ['Monday', 'Wednesday', 'Saturday'],
    },
    pastProjects: [],
    totalHoursContributed: 24,
    rating: 4.5,
    background: 'Software Engineer with passion for education',
    createdAt: new Date().toISOString(),
  };

  await saveVolunteer(volunteerProfile);

  await ensureAdminVolunteerConversation();

  // Mock status updates
  const statusUpdate: StatusUpdate = {
    id: 'status-1',
    projectId: 'project-1',
    status: 'In Progress',
    description: 'Construction of library shelves completed',
    updatedBy: 'admin-1',
    updatedAt: new Date().toISOString(),
  };

  await saveStatusUpdate(statusUpdate);

  console.log('Mock data initialized successfully');
}

async function ensurePartnerUser(): Promise<void> {
  const users = await getAllUsers();
  const hasPartnerUser = users.some(u => u.role === 'partner');
  if (hasPartnerUser) return;

  const partnerUser: User = {
    id: 'partner-user-1',
    email: 'partner@livelihoods.org',
    password: 'partner123',
    role: 'partner',
    name: 'Partner Organization User',
    phone: '+919876543211',
    createdAt: new Date().toISOString(),
  };

  await saveUser(partnerUser);
}

async function ensureAdminVolunteerConversation(): Promise<void> {
  const users = await getAllUsers();
  const hasAdmin = users.some(u => u.id === 'admin-1');
  const hasVolunteer = users.some(u => u.id === 'volunteer-1');
  if (!hasAdmin || !hasVolunteer) return;

  const messages = await getStorageItem<Message[]>(STORAGE_KEYS.MESSAGES) || [];
  const hasAdminToVolunteer = messages.some(
    m => m.senderId === 'admin-1' && m.recipientId === 'volunteer-1'
  );
  const hasVolunteerToAdmin = messages.some(
    m => m.senderId === 'volunteer-1' && m.recipientId === 'admin-1'
  );

  const now = Date.now();
  const seeds: Message[] = [];

  if (!hasAdminToVolunteer) {
    seeds.push({
      id: `msg-seed-admin-${now}`,
      senderId: 'admin-1',
      recipientId: 'volunteer-1',
      content: 'Welcome to the Volunteer System!',
      timestamp: new Date(now - 60_000).toISOString(),
      read: false,
    });
  }

  if (!hasVolunteerToAdmin) {
    seeds.push({
      id: `msg-seed-volunteer-${now}`,
      senderId: 'volunteer-1',
      recipientId: 'admin-1',
      content: 'Thank you! Glad to be part of the team.',
      timestamp: new Date(now - 30_000).toISOString(),
      read: false,
    });
  }

  if (seeds.length > 0) {
    await setStorageItem(STORAGE_KEYS.MESSAGES, [...messages, ...seeds]);
  }
}
