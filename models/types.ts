// User Roles
export type UserRole = 'admin' | 'volunteer' | 'partner';
export type UserType = 'Student' | 'Adult' | 'Senior';
export type NVCSector = 'Education' | 'Livelihood' | 'Nutrition';

// User
export interface User {
  id: string;
  email?: string;
  password: string; // In production, never store plain passwords
  role: UserRole;
  name: string;
  phone?: string;
  userType?: UserType;
  pillarsOfInterest?: NVCSector[];
  createdAt: string;
}

// Partner/Organization
export interface Partner {
  id: string;
  name: string;
  description: string;
  category: 'Education' | 'Livelihood' | 'Nutrition' | 'Other';
  contactEmail: string;
  contactPhone: string;
  address: string;
  status: 'Pending' | 'Approved' | 'Rejected'; // Admin validation
  validatedBy?: string; // Admin ID
  validatedAt?: string;
  createdAt: string;
  registrationDocuments?: string[]; // URLs to documents
}

// Project
export interface Project {
  id: string;
  title: string;
  description: string;
  partnerId: string;
  isEvent?: boolean;
  status: 'Planning' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';
  category: 'Education' | 'Livelihood' | 'Nutrition' | 'Other';
  startDate: string;
  endDate: string;
  location: {
    latitude: number;
    longitude: number;
    address: string;
  };
  volunteersNeeded: number;
  volunteers: string[]; // Volunteer IDs
  joinedUserIds?: string[];
  createdAt: string;
  updatedAt: string;
  statusUpdates: StatusUpdate[];
}

// Status Update for Project Lifecycle Tracking
export interface StatusUpdate {
  id: string;
  projectId: string;
  status: Project['status'];
  description: string;
  updatedBy: string; // User ID
  updatedAt: string;
}

// Volunteer
export interface Volunteer {
  id: string;
  userId: string; // Reference to User
  name: string;
  email: string;
  phone: string;
  skills: string[];
  skillsDescription: string;
  availability: {
    daysPerWeek: number;
    hoursPerWeek: number;
    availableDays: string[]; // ['Monday', 'Tuesday', etc.]
  };
  pastProjects: string[]; // Project IDs
  totalHoursContributed: number;
  rating: number; // 1-5
  engagementStatus: 'Open to Volunteer' | 'Busy';
  background: string;
  createdAt: string;
}

export interface VolunteerTimeLog {
  id: string;
  volunteerId: string;
  projectId: string;
  timeIn: string;
  timeOut?: string;
  note?: string;
}

// Communication/Message
export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  projectId?: string;
  content: string;
  timestamp: string;
  read: boolean;
  attachments?: string[]; // File URLs
}

// Matching (Volunteer to Project)
export interface VolunteerProjectMatch {
  id: string;
  volunteerId: string;
  projectId: string;
  status: 'Requested' | 'Matched' | 'Completed' | 'Cancelled';
  matchedAt: string;
  hoursContributed: number;
}

export interface PartnerProjectApplication {
  id: string;
  projectId: string;
  partnerUserId: string;
  partnerName: string;
  partnerEmail: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

// Admin Statistics
export interface AdminStats {
  totalPartners: number;
  approvedPartners: number;
  pendingPartners: number;
  totalProjects: number;
  activeProjects: number;
  totalVolunteers: number;
  totalHoursContributed: number;
}

export interface SectorNeed {
  sector: NVCSector;
  title: string;
  description: string;
  goalAmount: number;
}
