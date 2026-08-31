import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getAllProjects,
  getAllVolunteers,
  getAllPartners,
  getAllUsers,
  getAllPartnerReports,
  getAllPartnerProjectApplications,
  getAllVolunteerProjectMatches,
  getAllVolunteerTimeLogs,
  getAllProgramTracks,
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
      // Strategy: Load critical data FIRST (3-5 seconds), then background load the rest
      // Phase 1: Critical data for immediate UI (projects, volunteers, partners)
      updateProgress(10);
      
      const criticalData = await Promise.race([
        Promise.all([
          getAllProjects().catch(() => []),
          getAllVolunteers().catch(() => []),
          getAllPartners().catch(() => []),
        ]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Critical data timeout')), 5000)
        )
      ]) as any[];

      const [projects, volunteers, partners] = criticalData;
      
      // UI becomes usable NOW with critical data
      setState(prev => ({
        ...prev,
        projects,
        volunteers,
        partners,
        isLoading: false,
        isInitialized: true,
        loadingProgress: 60,
        lastUpdated: new Date(),
      }));

      console.log('✅ Critical data loaded (UI ready):', {
        projects: projects.length,
        volunteers: volunteers.length,
        partners: partners.length,
      });

      // Phase 2: Load remaining data in background (non-blocking)
      Promise.all([
        getAllUsers().catch(() => []),
        getAllPartnerReports().catch(() => []),
        getAllPartnerProjectApplications().catch(() => []),
        getAllVolunteerProjectMatches().catch(() => []),
        getAllVolunteerTimeLogs().catch(() => []),
        getAllProgramTracks().catch(() => []),
      ]).then(([users, reports, applications, matches, timeLogs, programTracks]) => {
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
        // Don't block UI - app still works with critical data
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
      async () => {
        console.log('🔄 Storage changed, refreshing cache...');
        // Refresh data in background without showing loading
        try {
          const [
            projects,
            volunteers,
            partners,
            users,
            reports,
            applications,
            matches,
            timeLogs,
            programTracks,
          ] = await Promise.all([
            getAllProjects().catch(() => state.projects),
            getAllVolunteers().catch(() => state.volunteers),
            getAllPartners().catch(() => state.partners),
            getAllUsers().catch(() => state.users),
            getAllPartnerReports().catch(() => state.reports),
            getAllPartnerProjectApplications().catch(() => state.applications),
            getAllVolunteerProjectMatches().catch(() => state.matches),
            getAllVolunteerTimeLogs().catch(() => state.timeLogs),
            getAllProgramTracks().catch(() => state.programTracks),
          ]);

          setState(prev => ({
            ...prev,
            projects,
            volunteers,
            partners,
            users,
            reports,
            applications,
            matches,
            timeLogs,
            programTracks,
            lastUpdated: new Date(),
          }));
        } catch (error) {
          console.error('Error refreshing cache:', error);
        }
      }
    );

    return () => {
      unsubscribe?.();
    };
  }, [state.isInitialized, state.projects, state.volunteers, state.partners, state.users, state.reports, state.applications, state.matches, state.timeLogs, state.programTracks]);

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
