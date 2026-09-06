import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getAllProjects,
  getAllVolunteers,
  getAllPartners,
  getCriticalGlobalData,
  getAllUsers,
  getAllPartnerReports,
  getAllPartnerProjectApplications,
  getAllVolunteerProjectMatches,
  getAllProgramTracks,
  getStorageItemsFast,
  subscribeToStorageChanges,
} from '../models/storage';
import {
  Project,
  Volunteer,
  Partner,
  User,
  PartnerReport,
  PartnerProjectApplication,
  VolunteerProjectMatch,
  VolunteerTimeLog,
  ProgramTrack,
} from '../models/types';

type GlobalDataState = {
  projects: Project[];
  volunteers: Volunteer[];
  partners: Partner[];
  users: User[];
  reports: PartnerReport[];
  applications: PartnerProjectApplication[];
  matches: VolunteerProjectMatch[];
  timeLogs: VolunteerTimeLog[];
  programTracks: ProgramTrack[];
  isLoading: boolean;
  isInitialized: boolean;
  loadingProgress: number;
  error: string | null;
  lastUpdated: Date | null;
};

type GlobalDataContextType = GlobalDataState & {
  refreshData: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshVolunteers: () => Promise<void>;
  refreshPartners: () => Promise<void>;
};

const GlobalDataContext = createContext<GlobalDataContextType | undefined>(undefined);

const INITIAL_STATE: GlobalDataState = {
  projects: [],
  volunteers: [],
  partners: [],
  users: [],
  reports: [],
  applications: [],
  matches: [],
  timeLogs: [],
  programTracks: [],
  isLoading: true,
  isInitialized: false,
  loadingProgress: 0,
  error: null,
  lastUpdated: null,
};

export function GlobalDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GlobalDataState>(INITIAL_STATE);

  const updateProgress = useCallback((progress: number) => {
    setState(prev => ({ ...prev, loadingProgress: Math.min(100, Math.max(0, progress)) }));
  }, []);

  const loadAllData = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null, loadingProgress: 0 }));
    
    try {
      updateProgress(15);
      
      // Fast path: Immediately load critical data (local storage hit < 50ms)
      const criticalDataPromise = getCriticalGlobalData();
      
      // Resilient race: if network takes >2.5s, fall back to cached data without throwing an error
      const criticalData = await Promise.race([
        criticalDataPromise,
        new Promise<{ projects: Project[]; volunteers: Volunteer[]; partners: Partner[] }>((resolve) => 
          setTimeout(async () => {
            try {
              const fallback = await getCriticalGlobalData();
              resolve(fallback);
            } catch {
              resolve({ projects: [], volunteers: [], partners: [] });
            }
          }, 2500)
        )
      ]);
      
      const { projects, volunteers, partners } = criticalData;
      
      // UI becomes usable NOW with critical data (< 100ms on warm cache, < 1.5s on cold)
      setState(prev => ({
        ...prev,
        projects: projects.length ? projects : prev.projects,
        volunteers: volunteers.length ? volunteers : prev.volunteers,
        partners: partners.length ? partners : prev.partners,
        isLoading: false,
        isInitialized: true,
        loadingProgress: 70,
        lastUpdated: new Date(),
      }));

      console.log('✅ Critical data loaded (UI ready):', {
        projects: projects.length,
        volunteers: volunteers.length,
        partners: partners.length,
      });

      // Phase 2: Load remaining data in a single batched background request (non-blocking)
      getStorageItemsFast([
        'users',
        'partnerReports',
        'partnerProjectApplications',
        'volunteerMatches',
        'volunteerTimeLogs',
        'programTracks',
      ]).then((items) => {
        const users = (items['users'] as User[] | null) || [];
        const reports = (items['partnerReports'] as PartnerReport[] | null) || [];
        const applications = (items['partnerProjectApplications'] as PartnerProjectApplication[] | null) || [];
        const matches = (items['volunteerMatches'] as VolunteerProjectMatch[] | null) || [];
        const timeLogs = (items['volunteerTimeLogs'] as VolunteerTimeLog[] | null) || [];
        const programTracks = (items['programTracks'] as ProgramTrack[] | null) || [];

        setState(prev => ({
          ...prev,
          users,
          reports,
          applications,
          matches,
          timeLogs,
          programTracks,
          loadingProgress: 100,
          lastUpdated: new Date(),
        }));

        console.log('✅ All data loaded (100%)');
      }).catch(error => {
        console.warn('⚠️ Secondary data load error (non-critical):', error);
      });
    } catch (error) {
      console.error('❌ Error loading global data:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        isInitialized: true,
        error: error instanceof Error ? error.message : 'Failed to load data',
      }));
    }
  }, [updateProgress]);

  // Refresh specific data types
  const refreshProjects = useCallback(async () => {
    try {
      const projects = await getAllProjects();
      setState(prev => ({ ...prev, projects, lastUpdated: new Date() }));
    } catch (error) {
      console.error('Error refreshing projects:', error);
    }
  }, []);

  const refreshVolunteers = useCallback(async () => {
    try {
      const volunteers = await getAllVolunteers();
      setState(prev => ({ ...prev, volunteers, lastUpdated: new Date() }));
    } catch (error) {
      console.error('Error refreshing volunteers:', error);
    }
  }, []);

  const refreshPartners = useCallback(async () => {
    try {
      const partners = await getAllPartners();
      setState(prev => ({ ...prev, partners, lastUpdated: new Date() }));
    } catch (error) {
      console.error('Error refreshing partners:', error);
    }
  }, []);

  const refreshData = useCallback(async () => {
    await loadAllData();
  }, [loadAllData]);

  // Initial load on mount
  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Subscribe to storage changes for automatic cache refresh
  useEffect(() => {
    if (!state.isInitialized) return;

    const unsubscribe = subscribeToStorageChanges(
      [
        'projects',
        'volunteers',
        'partners',
        'users',
        'partnerReports',
        'partnerProjectApplications',
        'volunteerMatches',
        'volunteerTimeLogs',
        'programTracks',
      ],
      async (event) => {
        console.log('🔄 Storage changed, refreshing cache for keys:', event.keys);
        try {
          const items = await getStorageItemsFast(event.keys);
          setState(prev => {
            const next = { ...prev, lastUpdated: new Date() };
            if (items['projects']) next.projects = items['projects'] as Project[];
            if (items['volunteers']) next.volunteers = items['volunteers'] as Volunteer[];
            if (items['partners']) next.partners = items['partners'] as Partner[];
            if (items['users']) next.users = items['users'] as User[];
            if (items['partnerReports']) next.reports = items['partnerReports'] as PartnerReport[];
            if (items['partnerProjectApplications']) next.applications = items['partnerProjectApplications'] as PartnerProjectApplication[];
            if (items['volunteerMatches']) next.matches = items['volunteerMatches'] as VolunteerProjectMatch[];
            if (items['volunteerTimeLogs']) next.timeLogs = items['volunteerTimeLogs'] as VolunteerTimeLog[];
            if (items['programTracks']) next.programTracks = items['programTracks'] as ProgramTrack[];
            return next;
          });
        } catch (error) {
          console.error('Error refreshing cache:', error);
        }
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, [state.isInitialized]);

  const value: GlobalDataContextType = {
    ...state,
    refreshData,
    refreshProjects,
    refreshVolunteers,
    refreshPartners,
  };

  return (
    <GlobalDataContext.Provider value={value}>
      {children}
    </GlobalDataContext.Provider>
  );
}

export function useGlobalData() {
  const context = useContext(GlobalDataContext);
  if (context === undefined) {
    throw new Error('useGlobalData must be used within a GlobalDataProvider');
  }
  return context;
}

// Convenience hooks for specific data types
export function useProjects() {
  const { projects, refreshProjects } = useGlobalData();
  return { projects, refreshProjects };
}

export function useVolunteers() {
  const { volunteers, refreshVolunteers } = useGlobalData();
  return { volunteers, refreshVolunteers };
}

export function usePartners() {
  const { partners, refreshPartners } = useGlobalData();
  return { partners, refreshPartners };
}

export function useUsers() {
  const { users } = useGlobalData();
  return { users };
}
