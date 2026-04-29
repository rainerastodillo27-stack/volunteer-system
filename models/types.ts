// Shared TypeScript models used by the frontend storage layer and screens.

// User role and profile enums used throughout the app.
export type UserRole = 'admin' | 'volunteer' | 'partner';
export type UserType = 'Student' | 'Adult' | 'Senior';
export type NVCSector = 'Education' | 'Livelihood' | 'Nutrition';
export type PartnerSectorType = 'NGO' | 'Hospital' | 'Institution' | 'Private';
export type AdvocacyFocus = 'Nutrition' | 'Education' | 'Livelihood' | 'Disaster';
export type PartnerReportType = 'General' | 'Medical' | 'Logistics';
export type ImpactHubReportType =
  | PartnerReportType
  | 'volunteer_engagement'
  | 'field_report'
  | 'program_impact'
  | 'event_performance'
  | 'partner_collaboration'
  | 'system_metrics';

// Represents an application account that can sign in to the system.
export interface User {
  id: string;
  email?: string;
  password: string; // In production, never store plain passwords
  role: UserRole;
  name: string;
  phone?: string;
  profilePhoto?: string;
  userType?: UserType;
  pillarsOfInterest?: NVCSector[];
  approvalStatus?: 'pending' | 'approved' | 'rejected'; // Admin approval for new users
  approvedBy?: string; // Admin user ID who approved
  approvedAt?: string; // When the account was approved
  rejectionReason?: string; // Reason if rejected
  createdAt: string;
}

// Represents a partner organization profile submitted to the system.
export interface Partner {
  id: string;
  ownerUserId?: string; // Partner account that owns/submitted this org profile
  name: string;
  description?: string;
  category: 'Education' | 'Livelihood' | 'Nutrition' | 'Disaster';
  sectorType: PartnerSectorType;
  dswdAccreditationNo: string;
  secRegistrationNo?: string;
  advocacyFocus: AdvocacyFocus[];
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  status: 'Pending' | 'Approved' | 'Rejected'; // Admin validation
  verificationStatus?: 'Pending' | 'Verified';
  verificationNotes?: string;
  validatedBy?: string; // Admin ID
  validatedAt?: string;
  credentialsUnlockedAt?: string;
  createdAt: string;
  registrationDocuments?: string[]; // URLs to documents
}

export interface ProjectInternalTask {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  status: 'Unassigned' | 'Assigned' | 'In Progress' | 'Completed';
  assignedVolunteerId?: string;
  assignedVolunteerName?: string;
  isFieldOfficer?: boolean;
  skillsNeeded: string[]; // Skills required for this specific task
  createdAt: string;
  updatedAt: string;
}

// Represents one customizable planning calendar available to admins.
export interface AdminPlanningCalendar {
  id: string;
  name: string;
  color: string;
  description?: string;
  planningItems?: AdminPlanningItem[];
  createdAt: string;
  updatedAt: string;
}

// Represents one scheduled planner entry shown inside the admin calendar.
export interface AdminPlanningItem {
  id: string;
  title: string;
  description?: string;
  calendarId: string;
  linkedProjectId?: string;
  startDate: string;
  endDate: string;
  location?: string;
  participantsLabel?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Represents a project or event managed inside the volunteer system.
export interface Project {
  id: string;
  title: string;
  description: string;
  partnerId: string;
  imageUrl?: string;
  imageHidden?: boolean;
  programModule?: AdvocacyFocus;
  isEvent?: boolean;
  parentProjectId?: string;
  status: 'Planning' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';
  category: 'Education' | 'Livelihood' | 'Nutrition' | 'Disaster';
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
  skillsNeeded?: string[]; // Skills required for this project/event
  createdAt: string;
  updatedAt: string;
  statusUpdates: StatusUpdate[];
  internalTasks?: ProjectInternalTask[];
}

// Represents one lifecycle update attached to a project.
export interface StatusUpdate {
  id: string;
  projectId: string;
  status: Project['status'];
  description: string;
  updatedBy: string; // User ID
  updatedAt: string;
}

// Represents a volunteer affiliation entry from the membership sheet.
export interface VolunteerAffiliation {
  organization: string;
  position: string;
}

// Represents a volunteer profile and activity metadata.
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
  gender?: string;
  dateOfBirth?: string;
  civilStatus?: string;
  homeAddress?: string;
  homeAddressRegion?: string;
  homeAddressCityMunicipality?: string;
  homeAddressBarangay?: string;
  occupation?: string;
  workplaceOrSchool?: string;
  collegeCourse?: string;
  certificationsOrTrainings?: string;
  hobbiesAndInterests?: string;
  specialSkills?: string;
  videoBriefingUrl?: string;
  affiliations?: VolunteerAffiliation[];
  registrationStatus?: 'Pending' | 'Approved' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  credentialsUnlockedAt?: string;
  createdAt: string;
}

// Represents a volunteer's time-in/time-out record for a project.
export interface VolunteerTimeLog {
  id: string;
  volunteerId: string;
  projectId: string;
  timeIn: string;
  timeOut?: string;
  note?: string;
  completionPhoto?: string;
  completionReport?: string;
}

// Represents a direct message between two users.
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

export type ProjectGroupMessageKind = 'message' | 'need-post' | 'scope-proposal';
export type NeedResponseAction = 'Can Help' | 'Working On It' | 'Delivered' | 'Need More Info';

export interface ProjectGroupNeedPost {
  title: string;
  category: string;
  details: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Open' | 'In Progress' | 'Fulfilled';
  quantityLabel?: string;
  targetDate?: string;
  requestedByRole: 'admin' | 'partner' | 'volunteer';
}

export interface ProjectGroupScopeProposal {
  title: string;
  description: string;
  included: string[]; // Included in scope
  excluded: string[]; // Excluded from scope
  timeline: string; // e.g., "Q1 2024" or "3 months"
  resources: string; // Brief resource requirements
  successCriteria: string; // How success will be measured
  proposedByRole: 'admin' | 'partner';
  proposedById: string; // User ID of proposer
  status: 'Draft' | 'Proposed' | 'Under Review' | 'Approved' | 'Rejected';
  approvalNotes?: string;
  approvedBy?: string; // Admin ID who approved
  approvedAt?: string; // When approved
  rejectionReason?: string; // Reason for rejection
}

// Represents a message posted inside a project group chat.
export interface ProjectGroupMessage {
  id: string;
  projectId: string;
  senderId: string;
  content: string;
  timestamp: string;
  kind?: ProjectGroupMessageKind | 'need-response';
  needPost?: ProjectGroupNeedPost;
  scopeProposal?: ProjectGroupScopeProposal;
  responseToMessageId?: string;
  responseAction?: NeedResponseAction;
  responseToTitle?: string;
  attachments?: string[]; // File URLs
}

// Represents a volunteer-to-project matching request or assignment.
export interface VolunteerProjectMatch {
  id: string;
  volunteerId: string;
  projectId: string;
  status: 'Requested' | 'Matched' | 'Completed' | 'Cancelled' | 'Rejected';
  requestedAt?: string;
  matchedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  hoursContributed: number;
}

// Represents a volunteer joining an event through either self-join or admin assignment.
export interface VolunteerProjectJoinRecord {
  id: string;
  projectId: string;
  volunteerId: string;
  volunteerUserId: string;
  volunteerName: string;
  volunteerEmail: string;
  joinedAt: string;
  source: 'VolunteerJoin' | 'AdminMatch';
  participationStatus: 'Active' | 'Completed';
  completedAt?: string;
  completedBy?: string;
}

export interface PartnerProjectProposalDetails {
  targetProjectId?: string;
  targetProjectTitle?: string;
  targetProjectDescription?: string;
  targetProjectAddress?: string;
  requestedProgramModule?: AdvocacyFocus;
  proposedTitle: string;
  proposedDescription: string;
  proposedStartDate: string;
  proposedEndDate: string;
  proposedLocation: string;
  proposedVolunteersNeeded: number;
  skillsNeeded?: string[]; // Skills required for this project/event
  communityNeed: string;
  expectedDeliverables: string;
  attachments?: {
    url: string;
    type: 'image' | 'document';
    description?: string;
  }[];
}

// Represents a partner's request to join a project or event.
export interface PartnerProjectApplication {
  id: string;
  projectId: string;
  partnerUserId: string;
  partnerName: string;
  partnerEmail: string;
  proposalDetails?: PartnerProjectProposalDetails;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

// Represents a partner-submitted operational or impact report for a project.
export interface PartnerReport {
  id: string;
  projectId: string;
  partnerId?: string;
  partnerUserId?: string;
  partnerName?: string;
  submitterUserId: string;
  submitterName: string;
  submitterRole: UserRole;
  title?: string;
  reportType: ImpactHubReportType;
  description: string;
  impactCount: number;
  metrics?: Record<string, number>;
  attachments?: {
    url: string;
    type: 'image' | 'video' | 'document' | 'media';
    description?: string;
  }[];
  mediaFile?: string;
  createdAt: string;
  status: 'Submitted' | 'Reviewed' | 'Rejected';
  reviewedAt?: string;
  reviewedBy?: string;
  viewedBy?: string[];
  reviewNotes?: string;
}

// Represents a generated final impact file that can be published to partners.
export interface PublishedImpactReport {
  id: string;
  projectId: string;
  generatedBy: string;
  generatedAt: string;
  reportFile: string;
  format: 'PDF' | 'Excel';
  downloadContent?: string;
  downloadMimeType?: string;
  sourceReportIds?: string[];
  publishedAt?: string;
}

// Represents top-level admin dashboard statistics.
export interface AdminStats {
  totalPartners: number;
  approvedPartners: number;
  pendingPartners: number;
  totalProjects: number;
  activeProjects: number;
  totalVolunteers: number;
  totalHoursContributed: number;
}

// Represents the organization's sector goals shown on partner dashboards.
export interface SectorNeed {
  sector: NVCSector;
  title: string;
  description: string;
  goalAmount: number;
}
