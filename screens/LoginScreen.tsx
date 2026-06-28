import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  Modal,
  useWindowDimensions,
  Image,
} from "react-native";
import ModernTheme from "../utils/modernTheme";

// Safe Platform accessor for web environments
function getPlatformOS(): string {
  try {
    const { Platform } = require("react-native");
    return Platform?.OS || "web";
  } catch {
    return "web";
  }
}

/**
 * Returns true when running in a real web browser BUT the user has NOT
 * requested mobile-emulation mode via the `?mode=mobile` query param.
 *
 * Visiting  http://localhost:8081/?mode=mobile  (or any URL with that param)
 * makes the web app behave exactly like the mobile app – volunteer and partner
 * accounts can log in, the role-selection screen appears, and the signup flow
 * is fully accessible.  This is useful for:
 *   • Playwright E2E tests that need to cover volunteer / partner UI
 *   • Developers who want to preview the mobile UI in a desktop browser
 */
function getIsWeb(): boolean {
  if (getPlatformOS() !== "web") return false;
  try {
    // Check for ?mode=mobile query param
    if (typeof window !== "undefined" && window?.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "mobile") return false;
    }
  } catch {
    // ignore – treat as normal web
  }
  return true;
}
import { MaterialIcons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  createUserAccount,
  getAllProjects,
  getAllUsers,
  getApiBaseUrl,
  getStorageItemFast,
  getUserByEmailOrPhone,
  validateDswdAccreditationNo,
  loginWithCredentials,
  subscribeToStorageChanges,
} from "../models/storage";
import { showError, showInfo } from "../utils/errorHandler";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "../components/AppLogo";
import InlineLoadError from "../components/InlineLoadError";
import {
  AdvocacyFocus,
  NVCSector,
  PartnerSectorType,
  User,
  UserRole,
  UserType,
} from "../models/types";
import {
  DEFAULT_VOLUNTEER_SKILL_OPTIONS,
  TASK_SKILL_OPTIONS,
  mergeSkillOptions,
} from "../utils/skills";
import {
  getRequestErrorMessage,
  getRequestErrorTitle,
  isAbortLikeError,
} from "../utils/requestErrors";
import { isImageMediaUri, pickImageFromDevice } from "../utils/media";
import {
  getBarangaysByCity,
  getCitiesByRegion,
  PHRegions,
  type PHBarangay,
  type PHCityMunicipality,
} from "../utils/philippineAddressData";

const BACKEND_HEALTH_TIMEOUT_MS = 30000;
const BACKEND_HEALTH_RETRY_MS = 6000;
const BACKEND_HEALTH_MAX_SLOW_RETRIES = 5;

type SignupVolunteerSheetState = {
  gender: string;
  dateOfBirth: string;
  civilStatus: string;
  homeAddress: string;
  homeAddressRegion: string;
  homeAddressCityMunicipality: string;
  homeAddressBarangay: string;
  occupation: string;
  workplaceOrSchool: string;
  collegeCourse: string;
  certificationsOrTrainings: string;
  specialSkills: string;
  skills: string[];
  affiliationOrg1: string;
  affiliationPos1: string;
};

type SignupPartnerApplicationState = {
  organizationName: string;
  sectorType: PartnerSectorType;
  dswdAccreditationNo: string;
  secRegistrationNo: string;
  advocacyFocus: AdvocacyFocus[];
};

type MobileEntryRole = Exclude<UserRole, "admin">;
type SignupStep = "role" | "details";
type DemoLoginAccount = {
  id: string;
  name: string;
  identifier: string;
  password: string;
  badge: string;
  mobileRole?: MobileEntryRole;
};

const ADMIN_DEMO_ACCOUNT: DemoLoginAccount = {
  id: "demo-admin",
  name: "Admin Account",
  identifier: "admin@nvc.org",
  password: "admin123",
  badge: "ADMIN",
};

const VOLUNTEER_DEMO_ACCOUNT: DemoLoginAccount = {
  id: "demo-volunteer",
  name: "Volunteer Account",
  identifier: "volunteer@example.com",
  password: "volunteer123",
  badge: "VOLUNTEER",
  mobileRole: "volunteer",
};

const PARTNER_DEMO_ACCOUNTS: DemoLoginAccount[] = [
  {
    id: "demo-partner-kabankalan",
    name: "Kabankalan LGU",
    identifier: "partner@livelihoods.org",
    password: "partner123",
    badge: "PARTNER",
    mobileRole: "partner",
  },
];

function getVisibleDemoAccounts(
  isWeb: boolean,
  selectedMobileRole: MobileEntryRole | null,
): DemoLoginAccount[] {
  if (isWeb) {
    return [ADMIN_DEMO_ACCOUNT];
  }

  if (selectedMobileRole === "volunteer") {
    return [VOLUNTEER_DEMO_ACCOUNT];
  }

  if (selectedMobileRole === "partner") {
    return PARTNER_DEMO_ACCOUNTS;
  }

  return [VOLUNTEER_DEMO_ACCOUNT, ...PARTNER_DEMO_ACCOUNTS];
}

// Returns a clean volunteer membership form state for the signup modal.
function createEmptySignupVolunteerSheet(): SignupVolunteerSheetState {
  return {
    gender: "",
    dateOfBirth: "",
    civilStatus: "",
    homeAddress: "",
    homeAddressRegion: "",
    homeAddressCityMunicipality: "",
    homeAddressBarangay: "",
    occupation: "",
    workplaceOrSchool: "",
    collegeCourse: "",
    certificationsOrTrainings: "",
    specialSkills: "",
    skills: [],
    affiliationOrg1: "",
    affiliationPos1: "",
  };
}

// Returns the default state for partner registration applications.
function createEmptySignupPartnerApplication(): SignupPartnerApplicationState {
  return {
    organizationName: "",
    sectorType: "NGO",
    dswdAccreditationNo: "",
    secRegistrationNo: "",
    advocacyFocus: [],
  };
}

function normalizeLoginPhone(value?: string): string {
  return (value || "").replace(/\D/g, "");
}

function getUserNotFoundDisplay(): { title: string; message: string } {
  return {
    title: "User Not Found",
    message:
      "No account was found for that username, email, or phone number. Please input a valid email, username, or phone.",
  };
}

function findUserByLoginIdentifier(
  users: User[],
  identifier: string,
): User | null {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const usernameAlias = normalizedIdentifier.includes("@")
    ? ""
    : normalizedIdentifier.split("@", 1)[0];
  const normalizedPhone = normalizeLoginPhone(identifier);

  return (
    users.find((user) => {
      const email = (user.email || "").trim().toLowerCase();
      const phone = normalizeLoginPhone(user.phone);

      return (
        email === normalizedIdentifier ||
        (Boolean(usernameAlias) && email.split("@", 1)[0] === usernameAlias) ||
        (Boolean(normalizedPhone) && phone === normalizedPhone)
      );
    }) || null
  );
}

function getLoginFailureDisplay(error: unknown): {
  title: string;
  message: string;
} {
  const message = getRequestErrorMessage(
    error,
    "Unable to sign in. Please try again.",
    {
      backendUrl: getApiBaseUrl(),
    },
  );
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("incorrect password") ||
    normalizedMessage.includes("wrong password")
  ) {
    return { title: "Incorrect Password", message: "Incorrect password" };
  }

  if (
    normalizedMessage.includes("user not found") ||
    normalizedMessage.includes("email not found") ||
    normalizedMessage.includes("username not found") ||
    normalizedMessage.includes("phone number not found") ||
    normalizedMessage.includes("account not found") ||
    normalizedMessage.includes("no account found")
  ) {
    return getUserNotFoundDisplay();
  }

  if (
    normalizedMessage.includes("pending approval") ||
    normalizedMessage.includes("not yet approved") ||
    normalizedMessage.includes("under review") ||
    normalizedMessage.includes("rejected")
  ) {
    return { title: "Login Unavailable", message };
  }

  return {
    title: getRequestErrorTitle(error, "Login Failed"),
    message,
  };
}

function getCachedLoginFailureDisplay(matchedUser: User | null): {
  title: string;
  message: string;
} {
  if (matchedUser) {
    return {
      title: "Incorrect Password",
      message:
        "Incorrect password. Please input a valid password and try again.",
    };
  }

  return getUserNotFoundDisplay();
}

function getCachedApprovalBlock(
  user: User | null,
): { title: string; message: string } | null {
  if (!user) {
    return null;
  }

  if (user.role === "volunteer") {
    if (user.approvalStatus === "pending") {
      return {
        title: "Login Unavailable",
        message: "Your volunteer account is still pending approval.",
      };
    }

    if (user.approvalStatus === "rejected") {
      return {
        title: "Login Unavailable",
        message:
          user.rejectionReason ||
          "Your volunteer account was rejected. Please contact the admin team.",
      };
    }
  }

  if (user.role === "partner") {
    if (user.approvalStatus === "pending") {
      return {
        title: "Login Unavailable",
        message:
          "Your organization application is still pending admin approval.",
      };
    }

    if (user.approvalStatus === "rejected") {
      return {
        title: "Login Unavailable",
        message:
          user.rejectionReason ||
          "Your organization application was rejected. Please contact the admin team.",
      };
    }
  }

  return null;
}

function getMobileRoleLabel(role: MobileEntryRole): string {
  return role === "partner" ? "Partner Organization" : "Volunteer";
}

function getMobileRoleLoginTitle(role: MobileEntryRole): string {
  return role === "partner"
    ? "Partner Organization Sign In"
    : "Volunteer Sign In";
}

function getMobileRoleLoginHint(role: MobileEntryRole): string {
  return role === "partner"
    ? "Use your approved organization email, email username, or phone number to open the partner portal."
    : "Use your approved volunteer email, email username, or phone number to open the volunteer portal.";
}

function getMobileRoleMismatchMessage(
  selectedRole: MobileEntryRole,
  actualRole: UserRole,
): string {
  if (actualRole === "admin") {
    return "This account is registered as an admin account. Please use the web portal for admin access.";
  }

  return selectedRole === "partner"
    ? "This account is registered as a volunteer. Go back and choose Volunteer before signing in."
    : "This account is registered as a partner organization. Go back and choose Partner Organization before signing in.";
}

// Handles account login and volunteer or partner self-registration.
export default function LoginScreen() {
  const isWeb = getIsWeb();
  const { width: screenWidth } = useWindowDimensions();
  const isCompactLayout = screenWidth < 480;
  const stackSelectionCards = screenWidth < 420;
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [loginError, setLoginError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [signupStep, setSignupStep] = useState<SignupStep>("role");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupAccountPhone, setSignupAccountPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupOtpCode, setSignupOtpCode] = useState("");
  const [signupOtpSentEmail, setSignupOtpSentEmail] = useState("");
  const [signupEmailVerified, setSignupEmailVerified] = useState(false);
  const [signupOtpLoading, setSignupOtpLoading] = useState(false);
  const [signupOtpVerifying, setSignupOtpVerifying] = useState(false);
  const [signupOtpMessage, setSignupOtpMessage] = useState("");
  const [signupUserType, setSignupUserType] = useState<UserType>("Student");
  const [signupPillars, setSignupPillars] = useState<NVCSector[]>([]);
  const [signupRole, setSignupRole] = useState<UserRole>("volunteer");
  const [signupPartnerApplication, setSignupPartnerApplication] =
    useState<SignupPartnerApplicationState>(
      createEmptySignupPartnerApplication(),
    );
  const [signupVolunteerSheet, setSignupVolunteerSheet] =
    useState<SignupVolunteerSheetState>(createEmptySignupVolunteerSheet());
  const [availableSkills, setAvailableSkills] = useState<string[]>(
    mergeSkillOptions(DEFAULT_VOLUNTEER_SKILL_OPTIONS, TASK_SKILL_OPTIONS),
  );
  const [customVolunteerSkill, setCustomVolunteerSkill] = useState("");
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const [signupAcceptedCommitment, setSignupAcceptedCommitment] =
    useState(false);
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [backendMessage, setBackendMessage] = useState(
    "Checking backend connection...",
  );
  const [savedAccounts, setSavedAccounts] = useState<User[]>([]);
  const [selectedMobileRole, setSelectedMobileRole] =
    useState<MobileEntryRole | null>(null);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedRegionCode, setSelectedRegionCode] = useState("");
  const [selectedCityCode, setSelectedCityCode] = useState("");
  const [filteredCities, setFilteredCities] = useState<PHCityMunicipality[]>(
    [],
  );
  const [filteredBarangays, setFilteredBarangays] = useState<PHBarangay[]>([]);
  const yearPickerListRef = useRef<ScrollView | null>(null);
  const { login } = useAuth();
  const mountedRef = useRef(true);
  const visibleDemoAccounts = getVisibleDemoAccounts(isWeb, selectedMobileRole);

  useEffect(() => {
    setInitialized(true);
    setLoading(false);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (signupVolunteerSheet.dateOfBirth) {
      const parsedDate = new Date(signupVolunteerSheet.dateOfBirth);
      if (!Number.isNaN(parsedDate.getTime())) {
        setSelectedDate(parsedDate);
        setSelectedYear(parsedDate.getFullYear());
      }
    }
  }, [signupVolunteerSheet.dateOfBirth]);

  useEffect(() => {
    if (showYearPicker && yearPickerListRef.current) {
      const currentYear = new Date().getFullYear();
      const selectedIndex = currentYear - selectedYear;
      const scrollOffset = selectedIndex * 56;
      yearPickerListRef.current.scrollTo({
        y: Math.max(0, scrollOffset - 80),
        animated: true,
      });
    }
  }, [showYearPicker, selectedYear]);

  useEffect(() => {
    const addressParts = [
      signupVolunteerSheet.homeAddressBarangay,
      signupVolunteerSheet.homeAddressCityMunicipality,
      signupVolunteerSheet.homeAddressRegion,
    ].map((value) => value.replace(/\s+/g, " ").trim());
    const composedHomeAddress = addressParts.every(Boolean)
      ? addressParts.join(", ")
      : "";

    setSignupVolunteerSheet((current) =>
      current.homeAddress === composedHomeAddress
        ? current
        : { ...current, homeAddress: composedHomeAddress },
    );
  }, [
    signupVolunteerSheet.homeAddressBarangay,
    signupVolunteerSheet.homeAddressCityMunicipality,
    signupVolunteerSheet.homeAddressRegion,
  ]);

  useEffect(() => {
    if (backendStatus !== "online") {
      setAvailableSkills(
        mergeSkillOptions(DEFAULT_VOLUNTEER_SKILL_OPTIONS, TASK_SKILL_OPTIONS),
      );
      return undefined;
    }

    let cancelled = false;

    const loadAvailableSkills = async () => {
      try {
        const projects = await getAllProjects();
        const projectSkills = projects.flatMap(
          (project) => project.skillsNeeded || [],
        );

        if (!cancelled) {
          setAvailableSkills(
            mergeSkillOptions(
              DEFAULT_VOLUNTEER_SKILL_OPTIONS,
              TASK_SKILL_OPTIONS,
              projectSkills,
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setAvailableSkills(
            mergeSkillOptions(
              DEFAULT_VOLUNTEER_SKILL_OPTIONS,
              TASK_SKILL_OPTIONS,
            ),
          );
        }
      }
    };

    void loadAvailableSkills();
    const unsubscribe = subscribeToStorageChanges(
      ["projects", "events"],
      () => {
        void loadAvailableSkills();
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [backendStatus]);

  useEffect(() => {
    let cancelled = false;
    let slowRetryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleBackendCheck = (delayMs: number) => {
      clearRetryTimer();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void checkBackend();
      }, delayMs);
    };

    // Checks whether the backend is reachable before allowing authentication flows.
    const checkBackend = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        BACKEND_HEALTH_TIMEOUT_MS,
      );

      try {
        setBackendStatus("checking");
        setBackendMessage("Checking backend and Supabase connection...");
        const response = await fetch(`${getApiBaseUrl()}/db-health`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as {
          status?: string;
          mode?: string;
          detail?: string;
          available?: boolean;
          error?: string;
        } | null;

        if (
          !response.ok ||
          payload?.status !== "ok" ||
          payload?.mode !== "postgres" ||
          payload?.available === false
        ) {
          throw new Error(
            payload?.detail ||
            payload?.error ||
            `Database backend is unavailable at ${getApiBaseUrl()}.`,
          );
        }

        if (!cancelled && mountedRef.current) {
          slowRetryCount = 0;
          setBackendStatus("online");
          setBackendMessage(
            `Backend connected to Postgres: ${getApiBaseUrl()}`,
          );
        }
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          if (isAbortLikeError(error)) {
            slowRetryCount += 1;

            if (slowRetryCount <= BACKEND_HEALTH_MAX_SLOW_RETRIES) {
              setBackendStatus("checking");
              setBackendMessage(
                "Backend response is taking longer than expected. Retrying connection check...",
              );
              scheduleBackendCheck(BACKEND_HEALTH_RETRY_MS);
              return;
            }

            setBackendStatus("offline");
            setBackendMessage(
              `Database backend did not respond at ${getApiBaseUrl()}. Check the backend process and Supabase connection, then run npm run all:bg or npm run all.`,
            );
            scheduleBackendCheck(BACKEND_HEALTH_RETRY_MS * 2);
            return;
          }

          const defaultMessage = `Database backend unavailable at ${getApiBaseUrl()}. Check the backend process and Supabase connection, then run npm run all:bg or npm run all.`;
          const fallbackMessage = getRequestErrorMessage(
            error,
            defaultMessage,
            {
              backendUrl: getApiBaseUrl(),
            },
          );

          setBackendStatus("offline");
          setBackendMessage(fallbackMessage);
          scheduleBackendCheck(BACKEND_HEALTH_RETRY_MS * 2);
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const schedule = setTimeout(() => {
      void checkBackend();
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(schedule);
      clearRetryTimer();
    };
  }, []);

  useEffect(() => {
    const applyVisibleSavedAccounts = (users: User[]) => {
      const uniqueUsers = Array.from(
        users
          .reduce((map, user) => {
            if (!map.has(user.id)) {
              map.set(user.id, user);
            }
            return map;
          }, new Map<string, User>())
          .values(),
      );

      const visibleUsers = uniqueUsers
        .filter((user) =>
          isWeb ? user.role === "admin" : user.role !== "admin",
        )
        .filter(
          (user) => user.role === "admin" || user.approvalStatus !== "pending",
        )
        .filter(
          (user) => user.role === "admin" || user.approvalStatus !== "rejected",
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      if (mountedRef.current) {
        setSavedAccounts(visibleUsers);
      }
    };

    // Loads stored accounts so users can quickly reuse credentials from this device.
    const loadSavedAccounts = async () => {
      try {
        const cachedUsers = (await getStorageItemFast<User[]>("users")) || [];
        applyVisibleSavedAccounts(cachedUsers);

        if (backendStatus !== "online") {
          return;
        }

        const users = await getAllUsers();
        applyVisibleSavedAccounts(users);
      } catch (error) {
        if (mountedRef.current) {
          setSavedAccounts([]);
        }
      }
    };

    void loadSavedAccounts();
    if (backendStatus !== "online") {
      return undefined;
    }

    const unsubscribe = subscribeToStorageChanges(["users"], () => {
      void loadSavedAccounts();
    });

    return unsubscribe;
  }, [backendStatus, isWeb]);

  // Authenticates the user with an email, email username, or phone identifier and password.
  const performLogin = async (
    rawIdentifier: string,
    rawPassword: string,
    roleOverride?: MobileEntryRole | null,
  ) => {
    const trimmedIdentifier = rawIdentifier.trim();
    const trimmedPassword = rawPassword.trim();
    const activeMobileRole = roleOverride ?? selectedMobileRole;
    const showLoginError = (title: string, message: string) => {
      setLoginError({ title, message });
      // Use centralized handler so web and mobile behave consistently
      showError(new Error(message), {
        fallbackTitle: title,
        fallbackMessage: message,
      });
    };

    setLoginError(null);

    if (!isWeb && !activeMobileRole) {
      Alert.alert(
        "Select Account Type",
        "Choose whether you are signing in as a volunteer or partner organization first.",
      );
      return;
    }

    if (!trimmedIdentifier || !trimmedPassword) {
      showLoginError("Validation Error", "Please fill in all fields");
      return;
    }

    const locallyMatchedUser = findUserByLoginIdentifier(
      savedAccounts,
      trimmedIdentifier,
    );
    const localPasswordMatches =
      locallyMatchedUser &&
      (locallyMatchedUser.password || "").trim() === trimmedPassword;

    if (backendStatus !== "online" && savedAccounts.length > 0) {
      if (!localPasswordMatches) {
        const failure = getCachedLoginFailureDisplay(locallyMatchedUser);
        showLoginError(failure.title, failure.message);
        return;
      }

      const user = locallyMatchedUser;
      if (!user) {
        const failure = getCachedLoginFailureDisplay(locallyMatchedUser);
        showLoginError(failure.title, failure.message);
        return;
      }

      if (!isWeb && activeMobileRole && user.role !== activeMobileRole) {
        showLoginError(
          "Role Mismatch",
          getMobileRoleMismatchMessage(activeMobileRole, user.role),
        );
        return;
      }

      if (isWeb && user.role !== "admin") {
        showLoginError(
          "Access Restricted",
          "Volunteer and partner accounts can only log in on mobile.",
        );
        return;
      }

      const cachedApprovalBlock = getCachedApprovalBlock(user);
      if (cachedApprovalBlock) {
        showLoginError(cachedApprovalBlock.title, cachedApprovalBlock.message);
        return;
      }

      setLoading(true);
      try {
        await login(user);
        setLoginError(null);
        setIdentifier("");
        setPassword("");
        setBackendStatus("checking");
        setBackendMessage(
          "Signed in with cached account data while the backend reconnects.",
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      if (backendStatus !== "online") {
        setBackendStatus("checking");
        setBackendMessage(
          "Trying to reach the database on a slow connection...",
        );
      }
      // Pre-check whether the identifier maps to any known account (email, username alias, or phone).
      // This lets us provide a more specific error to the user (username vs password).
      let identifierMatchedUser: User | null = null;
      try {
        identifierMatchedUser = await getUserByEmailOrPhone(trimmedIdentifier);
      } catch (e) {
        // If the lookup fails, fall back to attempting login normally.
        identifierMatchedUser = null;
      }

      if (!identifierMatchedUser) {
        // No local/mirrored account matches the identifier — inform the user.
        showLoginError(
          getUserNotFoundDisplay().title,
          getUserNotFoundDisplay().message,
        );
        return;
      }

      const user = await loginWithCredentials(
        trimmedIdentifier,
        trimmedPassword,
      );

      if (!user) {
        showLoginError(
          "Login Failed",
          "The backend did not return an account for this sign-in attempt. Please try again.",
        );
        return;
      }

      if (!isWeb && activeMobileRole && user.role !== activeMobileRole) {
        showLoginError(
          "Role Mismatch",
          getMobileRoleMismatchMessage(activeMobileRole, user.role),
        );
        return;
      }

      if (isWeb && user.role !== "admin") {
        showLoginError(
          "Access Restricted",
          "Volunteer and partner accounts can only log in on mobile.",
        );
        return;
      }

      // Update auth context - this triggers state change and navigation
      await login(user);
      setBackendStatus("online");
      setBackendMessage(`Backend connected to Postgres: ${getApiBaseUrl()}`);
      setLoginError(null);
      setIdentifier("");
      setPassword("");
    } catch (error: any) {
      const { title, message } = getLoginFailureDisplay(error);
      const isExpectedLoginFailure =
        title === "Login Unavailable" ||
        title === "Incorrect Password" ||
        title === "User Not Found" ||
        title === "Validation Error" ||
        title === "Access Restricted" ||
        title === "Role Mismatch";
      if (!isExpectedLoginFailure) {
        console.log("Login error:", error);
      }
      const normalizedMessage =
        typeof message === "string" ? message.toLowerCase() : "";
      if (
        title === "Database Unavailable" ||
        normalizedMessage.includes("database") ||
        normalizedMessage.includes("backend") ||
        normalizedMessage.includes("npm run all:bg") ||
        normalizedMessage.includes("npm run all")
      ) {
        setBackendStatus("offline");
        setBackendMessage(message);
      }
      showLoginError(title, message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    await performLogin(identifier, password);
  };

  const handleQuickLogin = async (account: DemoLoginAccount) => {
    setIdentifier(account.identifier);
    setPassword(account.password);
    if (!isWeb && account.mobileRole) {
      setSelectedMobileRole(account.mobileRole);
    }
    await performLogin(
      account.identifier,
      account.password,
      account.mobileRole ?? null,
    );
  };

  // Clears all signup fields after registration or when the modal is closed.
  const resetSignupForm = () => {
    setSignupName("");
    setSignupEmail("");
    setSignupAccountPhone("");
    setSignupPassword("");
    setSignupOtpCode("");
    setSignupOtpSentEmail("");
    setSignupEmailVerified(false);
    setSignupOtpLoading(false);
    setSignupOtpVerifying(false);
    setSignupOtpMessage("");
    setSignupUserType("Student");
    setSignupPillars([]);
    setSignupRole("volunteer");
    setSignupPartnerApplication(createEmptySignupPartnerApplication());
    setSignupVolunteerSheet(createEmptySignupVolunteerSheet());
    setCustomVolunteerSkill("");
    setShowSkillsDropdown(false);
    setSelectedRegionCode("");
    setSelectedCityCode("");
    setFilteredCities([]);
    setFilteredBarangays([]);
    setSignupAcceptedCommitment(false);
    setSignupStep("role");
  };

  const openSignupModal = () => {
    resetSignupForm();
    if (isWeb) {
      setSignupRole("admin");
      setSignupUserType("Adult");
      setSignupStep("details");
    }
    if (!isWeb && selectedMobileRole) {
      setSignupRole(selectedMobileRole);
      setSignupUserType(selectedMobileRole === "partner" ? "Adult" : "Student");
      setSignupStep("details");
    }
    setShowSignupModal(true);
  };

  const closeSignupModal = () => {
    setShowSignupModal(false);
    resetSignupForm();
  };

  const handleSelectSignupRole = (role: MobileEntryRole) => {
    setSignupRole(role);
    if (role === "partner") {
      setSignupUserType("Adult");
    }
    setSignupStep("details");
  };

  const handleSelectMobileRole = (
    role: MobileEntryRole,
    options?: { preserveCredentials?: boolean },
  ) => {
    setSelectedMobileRole(role);
    setLoginError(null);
    if (!options?.preserveCredentials) {
      setIdentifier("");
      setPassword("");
    }
  };

  const handleBackToRoleSelection = () => {
    setSelectedMobileRole(null);
    setIdentifier("");
    setPassword("");
    setLoginError(null);
  };

  // Updates one field in the volunteer membership form without replacing the whole object.
  const updateSignupVolunteerSheet = <
    K extends keyof SignupVolunteerSheetState,
  >(
    key: K,
    value: SignupVolunteerSheetState[K],
  ) => {
    setSignupVolunteerSheet((current) => ({ ...current, [key]: value }));
  };

  const handlePickVolunteerCertificate = async () => {
    try {
      const selectedImage = await pickImageFromDevice();
      if (!selectedImage) {
        return;
      }

      updateSignupVolunteerSheet("certificationsOrTrainings", selectedImage);
    } catch (error: any) {
      Alert.alert(
        "Certificate Upload Failed",
        error?.message ||
        "Unable to open the photo library for certificate upload.",
      );
    }
  };

  const handleAddCustomVolunteerSkill = () => {
    const normalizedSkill = customVolunteerSkill.trim();
    if (!normalizedSkill) {
      return;
    }

    setAvailableSkills((current) =>
      mergeSkillOptions(current, [normalizedSkill]),
    );
    setSignupVolunteerSheet((current) => ({
      ...current,
      skills: mergeSkillOptions(current.skills, [normalizedSkill]),
    }));
    setCustomVolunteerSkill("");
  };

  const handleToggleVolunteerSkill = (skill: string) => {
    setSignupVolunteerSheet((current) => {
      const isSelected = current.skills.includes(skill);
      return {
        ...current,
        skills: isSelected
          ? current.skills.filter((existingSkill) => existingSkill !== skill)
          : [...current.skills, skill],
      };
    });
  };

  const handleSelectRegion = (regionCode: string) => {
    const selectedRegion = PHRegions.find(
      (region) => region.code === regionCode,
    );
    updateSignupVolunteerSheet("homeAddressRegion", selectedRegion?.name || "");
    updateSignupVolunteerSheet("homeAddressCityMunicipality", "");
    updateSignupVolunteerSheet("homeAddressBarangay", "");
    setSelectedRegionCode(regionCode);
    setSelectedCityCode("");
    setFilteredCities(regionCode ? getCitiesByRegion(regionCode) : []);
    setFilteredBarangays([]);
  };

  const handleSelectCity = (cityCode: string) => {
    const selectedCity = filteredCities.find((city) => city.code === cityCode);
    updateSignupVolunteerSheet(
      "homeAddressCityMunicipality",
      selectedCity?.displayName || "",
    );
    updateSignupVolunteerSheet("homeAddressBarangay", "");
    setSelectedCityCode(cityCode);
    setFilteredBarangays(cityCode ? getBarangaysByCity(cityCode) : []);
  };

  const handleSelectBarangay = (barangayName: string) => {
    updateSignupVolunteerSheet("homeAddressBarangay", barangayName);
  };

  // Updates one field in the partner application form.
  const updateSignupPartnerApplication = <
    K extends keyof SignupPartnerApplicationState,
  >(
    key: K,
    value: SignupPartnerApplicationState[K],
  ) => {
    setSignupPartnerApplication((current) => ({ ...current, [key]: value }));
  };

  const handleSendSignupOtp = async () => {
    const normalizedEmail = signupEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      Alert.alert("Validation Error", "Please enter a valid email address before requesting a code.");
      return;
    }

    try {
      setSignupOtpLoading(true);
      setSignupOtpMessage("");
      setSignupEmailVerified(false);
      setSignupOtpCode("");
      const response = await fetch(`${getApiBaseUrl()}/auth/registration-otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}) as { detail?: string; message?: string });
      if (!response.ok) {
        throw new Error(data.detail || "Failed to send verification code.");
      }
      setSignupEmail(normalizedEmail);
      setSignupOtpSentEmail(normalizedEmail);
      setSignupOtpMessage("Code sent. Check your email.");
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, "Email Verification Failed"),
        getRequestErrorMessage(error, "Could not send the verification code.", {
          backendUrl: getApiBaseUrl(),
        }),
      );
    } finally {
      setSignupOtpLoading(false);
    }
  };

  const handleVerifySignupOtp = async () => {
    const normalizedEmail = signupEmail.trim().toLowerCase();
    const trimmedCode = signupOtpCode.trim();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      Alert.alert("Validation Error", "Please enter a valid email address.");
      return;
    }

    if (normalizedEmail !== signupOtpSentEmail) {
      Alert.alert("Verification Required", "Send a new code for this email address first.");
      return;
    }

    if (!trimmedCode || trimmedCode.length !== 6) {
      Alert.alert("Validation Error", "Please enter the 6-digit code sent to your email.");
      return;
    }

    try {
      setSignupOtpVerifying(true);
      const response = await fetch(`${getApiBaseUrl()}/auth/registration-otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, otp: trimmedCode }),
      });
      const data = await response.json().catch(() => ({}) as { detail?: string; message?: string });
      if (!response.ok) {
        throw new Error(data.detail || "Failed to verify email.");
      }
      setSignupEmailVerified(true);
      setSignupOtpMessage("Email verified.");
    } catch (error) {
      setSignupEmailVerified(false);
      Alert.alert(
        getRequestErrorTitle(error, "Verification Failed"),
        getRequestErrorMessage(error, "Could not verify the code.", {
          backendUrl: getApiBaseUrl(),
        }),
      );
    } finally {
      setSignupOtpVerifying(false);
    }
  };

  // Validates and creates a new volunteer or partner account.
  const handleSignup = async () => {
    if (!signupName.trim() || !signupPassword.trim()) {
      Alert.alert("Validation Error", "Name and password are required.");
      return;
    }

    if (!signupEmail.trim()) {
      Alert.alert(
        "Validation Error",
        "Please provide an email address.",
      );
      return;
    }

    if (signupEmail.trim() && !signupEmail.includes("@")) {
      Alert.alert("Validation Error", "Please enter a valid email address.");
      return;
    }

    if (!signupEmailVerified || signupEmail.trim().toLowerCase() !== signupOtpSentEmail) {
      Alert.alert("Email Verification Required", "Verify your email with the 6-digit code before creating the account.");
      return;
    }

    if (signupRole === "partner") {
      if (!signupPartnerApplication.organizationName.trim()) {
        Alert.alert("Validation Error", "Organization name is required.");
        return;
      }

      if (signupPartnerApplication.advocacyFocus.length === 0) {
        Alert.alert("Validation Error", "Select at least one advocacy focus.");
        return;
      }
    }

    if (signupRole === "volunteer") {
      if (
        !signupVolunteerSheet.gender.trim() ||
        !signupVolunteerSheet.dateOfBirth.trim() ||
        !signupVolunteerSheet.civilStatus.trim() ||
        !signupVolunteerSheet.homeAddressRegion.trim() ||
        !signupVolunteerSheet.homeAddressCityMunicipality.trim() ||
        !signupVolunteerSheet.homeAddressBarangay.trim() ||
        !signupVolunteerSheet.homeAddress.trim() ||
        !signupVolunteerSheet.occupation.trim() ||
        !signupVolunteerSheet.workplaceOrSchool.trim()
      ) {
        Alert.alert(
          "Validation Error",
          "Complete the volunteer membership information sheet before creating the account.",
        );
        return;
      }

      if (!signupAcceptedCommitment) {
        Alert.alert(
          "Validation Error",
          "You must accept the NVC volunteer commitment before creating the account.",
        );
        return;
      }
    }

    try {
      setSignupLoading(true);
      const createdUser = await createUserAccount({
        name: signupName,
        email: signupEmail,
        password: signupPassword,
        phone: signupAccountPhone,
        role: signupRole,
        userType: signupUserType,
        pillarsOfInterest:
          signupRole === "partner"
            ? signupPartnerApplication.advocacyFocus.filter(
              (focus): focus is NVCSector => focus !== "Disaster",
            )
            : signupPillars,
        partnerRegistration:
          signupRole === "partner"
            ? {
              organizationName:
                signupPartnerApplication.organizationName.trim(),
              sectorType: signupPartnerApplication.sectorType,
              dswdAccreditationNo:
                signupPartnerApplication.dswdAccreditationNo.trim(),
              secRegistrationNo:
                signupPartnerApplication.secRegistrationNo.trim(),
              advocacyFocus: signupPartnerApplication.advocacyFocus,
            }
            : undefined,
        volunteerMembershipSheet:
          signupRole === "volunteer"
            ? {
              gender: signupVolunteerSheet.gender.trim(),
              dateOfBirth: signupVolunteerSheet.dateOfBirth.trim(),
              civilStatus: signupVolunteerSheet.civilStatus.trim(),
              homeAddress: signupVolunteerSheet.homeAddress.trim(),
              homeAddressRegion:
                signupVolunteerSheet.homeAddressRegion.trim(),
              homeAddressCityMunicipality:
                signupVolunteerSheet.homeAddressCityMunicipality.trim(),
              homeAddressBarangay:
                signupVolunteerSheet.homeAddressBarangay.trim(),
              occupation: signupVolunteerSheet.occupation.trim(),
              workplaceOrSchool:
                signupVolunteerSheet.workplaceOrSchool.trim(),
              collegeCourse: signupVolunteerSheet.collegeCourse.trim(),
              certificationsOrTrainings:
                signupVolunteerSheet.certificationsOrTrainings.trim(),
              specialSkills: '',
              skills: signupVolunteerSheet.skills,
              affiliations: [
                {
                  organization: signupVolunteerSheet.affiliationOrg1.trim(),
                  position: signupVolunteerSheet.affiliationPos1.trim(),
                },
              ].filter(
                (affiliation) =>
                  affiliation.organization || affiliation.position,
              ),
            }
            : undefined,
      });

      setIdentifier(createdUser.email || createdUser.phone || "");
      setPassword(createdUser.password || "");
      if (!isWeb && signupRole !== "admin") {
        handleSelectMobileRole(signupRole, { preserveCredentials: true });
      }
      setShowSignupModal(false);
      resetSignupForm();
      Alert.alert(
        signupRole === "admin" ? "Admin Account Created" : "Application Submitted",
        signupRole === "admin"
          ? "The new admin account is ready to sign in on the web portal."
          : signupRole === "partner"
            ? "Your partner application was submitted. An admin must verify and approve it before partner login is unlocked."
            : "Your volunteer account was submitted. An admin must approve it before volunteer login is unlocked.",
      );
    } catch (error) {
      Alert.alert(
        getRequestErrorTitle(error, "Sign Up Error"),
        getRequestErrorMessage(error, "Failed to create account.", {
          backendUrl: getApiBaseUrl(),
        }),
      );
    } finally {
      setSignupLoading(false);
    }
  };

  // Signs in immediately with a saved account shown on this device.
  const handleUseSavedAccount = async (account: User) => {
    const nextIdentifier = account.email || account.phone || "";
    if (!nextIdentifier) {
      Alert.alert(
        "Login Unavailable",
        "This saved account does not have an email or phone number.",
      );
      return;
    }

    setLoginError(null);
    setIdentifier(nextIdentifier);
    const nextPassword = account.password || "";
    setPassword(nextPassword);
    if (!isWeb && account.role !== "admin") {
      setSelectedMobileRole(account.role);
    }
    await performLogin(
      nextIdentifier,
      nextPassword,
      account.role === "admin" ? null : account.role,
    );
  };

  const visibleSavedAccounts =
    isWeb || !selectedMobileRole
      ? savedAccounts
      : savedAccounts.filter((account) => account.role === selectedMobileRole);
  const selectedMobileRoleLabel = selectedMobileRole
    ? getMobileRoleLabel(selectedMobileRole)
    : "";
  const selectedMobileRoleTitle = selectedMobileRole
    ? getMobileRoleLoginTitle(selectedMobileRole)
    : "";
  const selectedMobileRoleHint = selectedMobileRole
    ? getMobileRoleLoginHint(selectedMobileRole)
    : "";
  const quickLoginTitle = isWeb
    ? "Quick Admin Sign In"
    : selectedMobileRole
      ? `${selectedMobileRoleLabel} Quick Sign In`
      : "Quick Demo Sign In";

  const renderQuickLoginSection = () => (
    <View style={styles.demoSection}>
      <Text style={styles.demoTitle}>{quickLoginTitle}</Text>
      {visibleDemoAccounts.map((account) => (
        <TouchableOpacity
          key={account.id}
          style={[
            styles.savedAccountCard,
            loading && styles.accountCardDisabled,
          ]}
          onPress={() => {
            void handleQuickLogin(account);
          }}
          activeOpacity={0.85}
          disabled={loading}
        >
          <View style={styles.savedAccountHeader}>
            <Text style={styles.savedAccountName}>{account.name}</Text>
            <Text style={styles.savedAccountRole}>{account.badge}</Text>
          </View>
          <Text style={styles.savedAccountCredential}>
            {account.identifier}
          </Text>
          <Text style={styles.savedAccountPassword}>{account.password}</Text>
          <Text style={styles.savedAccountHint}>Tap to sign in instantly</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  if (loading && !initialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Initializing app...</Text>
      </View>
    );
  }

  return (
    <>
      {isWeb ? (
        <ImageBackground
          source={require("../assets/about-us-2020.jpg")}
          style={styles.webBackgroundImage}
          resizeMode="cover"
        >
          <View style={styles.webDarkOverlay} />
        </ImageBackground>
      ) : null}

      <ScrollView
        style={[styles.container, isWeb && styles.webOuterContainer]}
        contentContainerStyle={[
          styles.contentContainer,
          isWeb && styles.webContentContainer,
          isCompactLayout && styles.compactContentContainer,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <View
          style={[
            styles.pageWrapper,
            isWeb && styles.webPage,
            isWeb && screenWidth < 960 && styles.webPageStacked,
          ]}
        >
          {isWeb ? (
            <View style={styles.webHeroPane}>
              <View style={styles.leftBrandHeader}>
                <AppLogo width={72} />
              </View>
              <View style={styles.pillBadge}>
                <Text style={styles.pillBadgeText}>NVC FOUNDATION</Text>
              </View>
              <Text style={styles.webHeroHeading}>
                FIGHT HUNGER.{"\n"}BUILD HOPE.
              </Text>
              <Text style={styles.webHeroText}>
                Connecting volunteers, partner organizations, and community
                programs to provide nutrition, access to quality education, and
                livelihood opportunities for Negros.
              </Text>
            </View>
          ) : null}

          <View
            style={[
              styles.contentShell,
              isWeb ? styles.webCardShell : styles.mobileContentShell,
              isCompactLayout && styles.compactContentShell,
              isWeb && screenWidth < 960 && styles.webCardShellStacked,
            ]}
          >
            {!isWeb ? (
              <View style={styles.brandSection}>
                <AppLogo width={138} />
                <Text style={styles.title}>NVC</Text>
                <Text style={styles.subtitle}>
                  Volunteer coordination platform
                </Text>
              </View>
            ) : null}

            {false ? (
              <View style={styles.webAccessNotice}>
                <Text style={styles.webAccessNoticeTitle}>
                  Web access is for admin only
                </Text>
                <Text style={styles.webAccessNoticeText}>
                  Volunteer and partner accounts can sign in through the mobile
                  app.
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.backendStatusCard,
                backendStatus === "online"
                  ? styles.backendStatusOnline
                  : backendStatus === "offline"
                    ? styles.backendStatusOffline
                    : styles.backendStatusChecking,
              ]}
            >
              <View style={styles.backendStatusRow}>
                <View
                  style={[
                    styles.backendStatusDot,
                    backendStatus === "online"
                      ? styles.backendStatusDotOnline
                      : backendStatus === "offline"
                        ? styles.backendStatusDotOffline
                        : styles.backendStatusDotChecking,
                  ]}
                />
                <Text style={styles.backendStatusTitle}>
                  {backendStatus === "online"
                    ? "Database Connected"
                    : backendStatus === "offline"
                      ? "Database Unavailable"
                      : "Checking Database"}
                </Text>
              </View>
              <Text style={styles.backendStatusText}>{backendMessage}</Text>
            </View>

            {!isWeb && !selectedMobileRole ? (
              <>
                <View style={styles.selectionDashboard}>
                  <Text style={styles.selectionTitle}>
                    Choose Your Mobile Portal
                  </Text>
                  <Text style={styles.selectionSubtitle}>
                    Select whether you are signing in as a volunteer or a
                    partner organization before continuing.
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.selectionCard,
                      stackSelectionCards && styles.selectionCardStacked,
                    ]}
                    onPress={() => handleSelectMobileRole("volunteer")}
                    activeOpacity={0.9}
                  >
                    <View style={styles.selectionIconWrap}>
                      <MaterialIcons
                        name="volunteer-activism"
                        size={28}
                        color="#166534"
                      />
                    </View>
                    <View style={styles.selectionCopy}>
                      <Text style={styles.selectionCardTitle}>Volunteer</Text>
                      <Text style={styles.selectionCardDescription}>
                        Join projects, track your hours, and manage your
                        volunteer activities.
                      </Text>
                      <Text style={styles.selectionCardAction}>
                        Continue as Volunteer
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.selectionCard,
                      styles.selectionCardPartner,
                      stackSelectionCards && styles.selectionCardStacked,
                    ]}
                    onPress={() => handleSelectMobileRole("partner")}
                    activeOpacity={0.9}
                  >
                    <View
                      style={[
                        styles.selectionIconWrap,
                        styles.selectionIconWrapPartner,
                      ]}
                    >
                      <MaterialIcons
                        name="business"
                        size={28}
                        color="#92400e"
                      />
                    </View>
                    <View style={styles.selectionCopy}>
                      <Text style={styles.selectionCardTitle}>
                        Partner Organization
                      </Text>
                      <Text style={styles.selectionCardDescription}>
                        Coordinate organization projects, submit reports, and
                        collaborate with NVC.
                      </Text>
                      <Text
                        style={[
                          styles.selectionCardAction,
                          styles.selectionCardActionPartner,
                        ]}
                      >
                        Continue as Partner Organization
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {renderQuickLoginSection()}

                <TouchableOpacity onPress={openSignupModal}>
                  <Text style={styles.signupText}>
                    Sign up as Volunteer or Partner
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {!isWeb && selectedMobileRole ? (
                  <View style={styles.mobileRoleBanner}>
                    <TouchableOpacity
                      style={styles.backToRoleButton}
                      onPress={handleBackToRoleSelection}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons
                        name="arrow-back"
                        size={18}
                        color="#166534"
                      />
                      <Text style={styles.backToRoleText}>
                        Change account type
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.mobileRoleBannerHeader}>
                      <MaterialIcons
                        name={
                          selectedMobileRole === "partner"
                            ? "business"
                            : "volunteer-activism"
                        }
                        size={22}
                        color={
                          selectedMobileRole === "partner"
                            ? "#92400e"
                            : "#166534"
                        }
                      />
                      <Text style={styles.mobileRoleBannerTitle}>
                        {selectedMobileRoleTitle}
                      </Text>
                    </View>
                    <Text style={styles.mobileRoleBannerText}>
                      {selectedMobileRoleHint}
                    </Text>
                  </View>
                ) : null}

                <TextInput
                  style={[styles.input, isCompactLayout && styles.compactInput]}
                  placeholder="Email, Username, or Phone"
                  placeholderTextColor="#999"
                  value={identifier}
                  onChangeText={(value) => {
                    setIdentifier(value);
                    if (loginError) {
                      setLoginError(null);
                    }
                  }}
                  editable={!loading}
                />

                <TextInput
                  style={[styles.input, isCompactLayout && styles.compactInput]}
                  placeholder="Password"
                  placeholderTextColor="#999"
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (loginError) {
                      setLoginError(null);
                    }
                  }}
                  secureTextEntry
                  editable={!loading}
                />

                {loginError ? (
                  <InlineLoadError
                    title={loginError.title}
                    message={loginError.message}
                  />
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.button,
                    isCompactLayout && styles.compactButton,
                    loading ? styles.buttonDisabled : null,
                  ]}
                  onPress={() => {
                    void handleLogin();
                  }}
                  disabled={loading || !identifier || !password}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>
                      {isWeb && !identifier && !password ? "Quick Sign In" : "Log In"}
                    </Text>
                  )}
                </TouchableOpacity>

                {renderQuickLoginSection()}

                {visibleSavedAccounts.length > 0 && (
                  <View style={styles.demoSection}>
                    <Text style={styles.demoTitle}>
                      {isWeb
                        ? "Saved Admin Accounts:"
                        : `Saved ${selectedMobileRoleLabel} Accounts:`}
                    </Text>
                    {visibleSavedAccounts.map((account) => (
                      <TouchableOpacity
                        key={account.id}
                        style={[
                          styles.savedAccountCard,
                          loading && styles.accountCardDisabled,
                        ]}
                        onPress={() => {
                          void handleUseSavedAccount(account);
                        }}
                        activeOpacity={0.85}
                        disabled={loading}
                      >
                        <View style={styles.savedAccountHeader}>
                          <Text style={styles.savedAccountName}>
                            {account.name}
                          </Text>
                          <Text style={styles.savedAccountRole}>
                            {account.role}
                          </Text>
                        </View>
                        <Text style={styles.savedAccountCredential}>
                          {account.email ||
                            account.phone ||
                            "No login identifier"}
                        </Text>
                        <Text style={styles.savedAccountPassword}>
                          {account.password}
                        </Text>
                        <Text style={styles.savedAccountHint}>
                          Tap to sign in instantly
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {isWeb ? (
                  <TouchableOpacity onPress={openSignupModal}>
                    <Text style={styles.signupText}>Sign up as Admin</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={openSignupModal}>
                    <Text style={styles.signupText}>
                      {!selectedMobileRole
                        ? "Sign up as Volunteer or Partner"
                        : `Sign up as ${selectedMobileRoleLabel}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {showSignupModal ? (
        <Modal
          visible
          animationType="slide"
          transparent
          onRequestClose={closeSignupModal}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {signupStep === "role"
                  ? "Choose Account Type"
                  : signupRole === "admin"
                    ? "Admin Registration"
                    : signupRole === "partner"
                      ? "Partner Registration"
                      : "Volunteer Registration"}
              </Text>
              <Text style={styles.modalSubtitle}>
                {signupStep === "role"
                  ? "Choose how you want to sign up. Access after registration will follow the selected role."
                  : signupRole === "admin"
                    ? "Create another administrator account for the web management portal."
                    : signupRole === "volunteer"
                      ? "Register with email or phone, choose a profile type, and complete the volunteer membership information sheet."
                      : "Submit your organization application with DSWD details. Partner login is unlocked after admin approval."}
              </Text>

              {signupStep === "role" ? (
                <View style={styles.signupRoleChoiceGrid}>
                  {[
                    {
                      role: "volunteer" as const,
                      icon: "volunteer-activism" as const,
                      title: "Volunteer",
                      description:
                        "Join projects, log hours, and access volunteer-only screens after approval.",
                    },
                    {
                      role: "partner" as const,
                      icon: "business" as const,
                      title: "Partner Organization",
                      description:
                        "Submit an organization application and access partner tools after approval.",
                    },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.role}
                      style={styles.signupRoleCard}
                      onPress={() => handleSelectSignupRole(option.role)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <View style={styles.signupRoleCardHeader}>
                        <MaterialIcons
                          name={option.icon}
                          size={22}
                          color="#166534"
                        />
                        <Text style={styles.signupRoleCardTitle}>
                          {option.title}
                        </Text>
                      </View>
                      <Text style={styles.signupRoleCardDescription}>
                        {option.description}
                      </Text>
                      <Text style={styles.signupRoleCardAction}>
                        {option.role === "volunteer"
                          ? "Continue as Volunteer"
                          : "Continue as Partner"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <ScrollView
                  style={styles.modalForm}
                  contentContainerStyle={styles.modalFormContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  scrollEnabled={true}
                >
                  <TextInput
                    style={styles.input}
                    placeholder={
                      signupRole === "partner"
                        ? "Primary Contact Name"
                        : "Full Name"
                    }
                    placeholderTextColor="#999"
                    value={signupName}
                    onChangeText={setSignupName}
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor="#999"
                    value={signupEmail}
                    onChangeText={(value) => {
                      setSignupEmail(value);
                      setSignupEmailVerified(false);
                      setSignupOtpCode("");
                      setSignupOtpMessage("");
                      if (value.trim().toLowerCase() !== signupOtpSentEmail) {
                        setSignupOtpSentEmail("");
                      }
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={!signupLoading}
                  />
                  <View style={styles.signupOtpBox}>
                    <View style={styles.signupOtpHeader}>
                      <Text style={styles.signupOtpTitle}>
                        {signupEmailVerified ? "Email verified" : "Email verification"}
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.signupOtpButton,
                          (signupOtpLoading || signupLoading || !signupEmail.trim()) && styles.buttonDisabled,
                        ]}
                        onPress={handleSendSignupOtp}
                        disabled={signupOtpLoading || signupLoading || !signupEmail.trim()}
                      >
                        {signupOtpLoading ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.signupOtpButtonText}>
                            {signupOtpSentEmail ? "Resend Code" : "Send Code"}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    <View style={styles.signupOtpRow}>
                      <TextInput
                        style={[styles.input, styles.signupOtpInput]}
                        placeholder="6-digit code"
                        placeholderTextColor="#999"
                        value={signupOtpCode}
                        onChangeText={(value) => {
                          setSignupOtpCode(value.replace(/[^0-9]/g, "").slice(0, 6));
                          setSignupOtpMessage("");
                        }}
                        keyboardType="number-pad"
                        maxLength={6}
                        editable={!signupLoading && !signupEmailVerified}
                      />
                      <TouchableOpacity
                        style={[
                          styles.signupOtpVerifyButton,
                          (signupOtpVerifying || signupLoading || signupEmailVerified || signupOtpCode.length < 6) && styles.buttonDisabled,
                        ]}
                        onPress={handleVerifySignupOtp}
                        disabled={signupOtpVerifying || signupLoading || signupEmailVerified || signupOtpCode.length < 6}
                      >
                        {signupOtpVerifying ? (
                          <ActivityIndicator color="#166534" size="small" />
                        ) : (
                          <Text style={styles.signupOtpVerifyText}>Verify</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    {signupOtpMessage ? (
                      <Text
                        style={[
                          styles.signupOtpMessage,
                          signupEmailVerified && styles.signupOtpMessageSuccess,
                        ]}
                      >
                        {signupOtpMessage}
                      </Text>
                    ) : null}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number"
                    placeholderTextColor="#999"
                    value={signupAccountPhone}
                    onChangeText={setSignupAccountPhone}
                    keyboardType="phone-pad"
                    editable={!signupLoading}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#999"
                    value={signupPassword}
                    onChangeText={setSignupPassword}
                    secureTextEntry
                    editable={!signupLoading}
                  />

                  {signupRole === "volunteer" ? (
                    <>
                      <Text style={styles.modalSectionLabel}>
                        Profile Creation
                      </Text>
                      <View style={styles.roleSelector}>
                        {(["Student", "Adult", "Senior"] as const).map(
                          (userType) => (
                            <TouchableOpacity
                              key={userType}
                              style={[
                                styles.roleChip,
                                signupUserType === userType &&
                                styles.roleChipActive,
                              ]}
                              onPress={() => {
                                setSignupUserType(userType);
                              }}
                              disabled={signupLoading}
                              hitSlop={8}
                            >
                              <Text
                                style={[
                                  styles.roleChipText,
                                  signupUserType === userType &&
                                  styles.roleChipTextActive,
                                ]}
                              >
                                {userType}
                              </Text>
                            </TouchableOpacity>
                          ),
                        )}
                      </View>

                    </>
                  ) : signupRole === "partner" ? (
                    <>
                      <Text style={styles.modalSectionLabel}>
                        Organization Application
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Organization Name"
                        placeholderTextColor="#999"
                        value={signupPartnerApplication.organizationName}
                        onChangeText={(value) =>
                          updateSignupPartnerApplication(
                            "organizationName",
                            value,
                          )
                        }
                        editable={!signupLoading}
                      />

                      <Text style={styles.modalSectionSubLabel}>
                        Sector Type
                      </Text>
                      <View style={styles.pillarGrid}>
                        {(
                          ["NGO", "Hospital", "Institution", "Private"] as const
                        ).map((sector) => {
                          const selected =
                            signupPartnerApplication.sectorType === sector;
                          return (
                            <TouchableOpacity
                              key={sector}
                              style={[
                                styles.pillarChip,
                                selected && styles.pillarChipActive,
                              ]}
                              onPress={() =>
                                updateSignupPartnerApplication(
                                  "sectorType",
                                  sector,
                                )
                              }
                              disabled={signupLoading}
                            >
                              <Text
                                style={[
                                  styles.pillarChipText,
                                  selected && styles.pillarChipTextActive,
                                ]}
                              >
                                {sector}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <Text style={styles.fieldLabel}>
                        DSWD Accreditation Number
                      </Text>
                      <Text style={styles.fieldHelpText}>
                        Enter your DSWD accreditation number (optional).
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="DSWD Accreditation No. (optional)"
                        placeholderTextColor="#999"
                        value={signupPartnerApplication.dswdAccreditationNo}
                        onChangeText={(value) =>
                          updateSignupPartnerApplication(
                            "dswdAccreditationNo",
                            value,
                          )
                        }
                        autoCapitalize="characters"
                        editable={!signupLoading}
                      />

                      <TextInput
                        style={styles.input}
                        placeholder="SEC Registration No. (optional)"
                        placeholderTextColor="#999"
                        value={signupPartnerApplication.secRegistrationNo}
                        onChangeText={(value) =>
                          updateSignupPartnerApplication(
                            "secRegistrationNo",
                            value,
                          )
                        }
                        autoCapitalize="characters"
                        editable={!signupLoading}
                      />

                      <Text style={styles.modalSectionSubLabel}>
                        Advocacy Focus
                      </Text>
                      <View style={styles.pillarGrid}>
                        {(
                          [
                            "Nutrition",
                            "Education",
                            "Livelihood",
                            "Disaster",
                          ] as const
                        ).map((focus) => {
                          const selected =
                            signupPartnerApplication.advocacyFocus.includes(
                              focus,
                            );
                          return (
                            <TouchableOpacity
                              key={focus}
                              style={[
                                styles.pillarChip,
                                selected && styles.pillarChipActive,
                              ]}
                              onPress={() =>
                                updateSignupPartnerApplication(
                                  "advocacyFocus",
                                  selected
                                    ? signupPartnerApplication.advocacyFocus.filter(
                                      (item) => item !== focus,
                                    )
                                    : [
                                      ...signupPartnerApplication.advocacyFocus,
                                      focus,
                                    ],
                                )
                              }
                              disabled={signupLoading}
                            >
                              <Text
                                style={[
                                  styles.pillarChipText,
                                  selected && styles.pillarChipTextActive,
                                ]}
                              >
                                {focus}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      <View style={styles.partnerLockNotice}>
                        <MaterialIcons
                          name="verified-user"
                          size={18}
                          color="#92400e"
                        />
                        <Text style={styles.partnerLockNoticeText}>
                          Admin will review your application and unlock partner
                          login after approval.
                        </Text>
                      </View>
                    </>
                  ) : null}

                  {signupRole === "volunteer" && (
                    <>
                      <Text style={styles.modalSectionLabel}>
                        NVC Membership Information Sheet
                      </Text>

                      <Text style={styles.modalSectionSubLabel}>Gender</Text>
                      <View style={styles.genderGrid}>
                        {["Male", "Female", "Other"].map((gender) => (
                          <TouchableOpacity
                            key={gender}
                            style={[
                              styles.genderChip,
                              signupVolunteerSheet.gender === gender &&
                              styles.genderChipActive,
                            ]}
                            onPress={() => {
                              updateSignupVolunteerSheet("gender", gender);
                            }}
                            disabled={signupLoading}
                            hitSlop={8}
                          >
                            <Text
                              style={[
                                styles.genderChipText,
                                signupVolunteerSheet.gender === gender &&
                                styles.genderChipTextActive,
                              ]}
                            >
                              {gender}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={styles.modalSectionSubLabel}>
                        Date of Birth
                      </Text>
                      {getPlatformOS() === "web" ? (
                        <input
                          type="date"
                          value={signupVolunteerSheet.dateOfBirth}
                          max={new Date().toISOString().split("T")[0]}
                          onChange={(event) => {
                            updateSignupVolunteerSheet(
                              "dateOfBirth",
                              event.target.value,
                            );
                          }}
                          disabled={signupLoading}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            borderRadius: "12px",
                            border: "1px solid #ddd",
                            fontSize: "16px",
                            color: "#333",
                            backgroundColor: "#fff",
                            minHeight: "54px",
                            boxSizing: "border-box",
                            fontFamily: "inherit",
                            marginBottom: "15px",
                            outline: "none",
                            cursor: "pointer",
                          }}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.button, styles.datePickerButton]}
                          onPress={() => {
                            setShowYearPicker(true);
                          }}
                          disabled={signupLoading}
                          hitSlop={8}
                        >
                          <MaterialIcons
                            name="calendar-today"
                            size={20}
                            color="#fff"
                          />
                          <Text style={styles.datePickerButtonText}>
                            {signupVolunteerSheet.dateOfBirth
                              ? new Date(
                                signupVolunteerSheet.dateOfBirth,
                              ).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })
                              : "Select Date of Birth"}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <Text style={styles.modalSectionSubLabel}>
                        Civil Status
                      </Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={signupVolunteerSheet.civilStatus}
                          onValueChange={(itemValue: string) =>
                            updateSignupVolunteerSheet("civilStatus", itemValue)
                          }
                          enabled={!signupLoading}
                          style={styles.picker}
                        >
                          <Picker.Item
                            label="Select Civil Status..."
                            value=""
                          />
                          {[
                            "Single",
                            "Married",
                            "Widowed",
                            "Separated",
                            "Domestic Partnership",
                          ].map((status) => (
                            <Picker.Item
                              key={status}
                              label={status}
                              value={status}
                            />
                          ))}
                        </Picker>
                      </View>

                      <Text style={styles.modalSectionLabel}>
                        Home Address (Philippines)
                      </Text>

                      <Text style={styles.modalSectionSubLabel}>Region</Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={selectedRegionCode}
                          onValueChange={(itemValue: string) =>
                            handleSelectRegion(itemValue)
                          }
                          enabled={!signupLoading}
                          style={styles.picker}
                        >
                          <Picker.Item label="Select Region..." value="" />
                          {PHRegions.map((region) => (
                            <Picker.Item
                              key={region.code}
                              label={region.name}
                              value={region.code}
                            />
                          ))}
                        </Picker>
                      </View>

                      <Text style={styles.modalSectionSubLabel}>
                        City / Municipality
                      </Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={selectedCityCode}
                          onValueChange={(itemValue: string) =>
                            handleSelectCity(itemValue)
                          }
                          enabled={!signupLoading && selectedRegionCode !== ""}
                          style={styles.picker}
                        >
                          <Picker.Item
                            label="Select City / Municipality..."
                            value=""
                          />
                          {filteredCities.map((city) => (
                            <Picker.Item
                              key={city.code}
                              label={city.displayName}
                              value={city.code}
                            />
                          ))}
                        </Picker>
                      </View>

                      <Text style={styles.modalSectionSubLabel}>Barangay</Text>
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={
                            signupVolunteerSheet.homeAddressBarangay
                          }
                          onValueChange={(itemValue: string) =>
                            handleSelectBarangay(itemValue)
                          }
                          enabled={!signupLoading && selectedCityCode !== ""}
                          style={styles.picker}
                        >
                          <Picker.Item label="Select Barangay..." value="" />
                          {filteredBarangays.map((barangay) => (
                            <Picker.Item
                              key={barangay.code}
                              label={barangay.displayName}
                              value={barangay.name}
                            />
                          ))}
                        </Picker>
                      </View>

                      <Text style={styles.modalSectionLabel}>
                        Professional Information
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Occupation"
                        placeholderTextColor="#999"
                        value={signupVolunteerSheet.occupation}
                        onChangeText={(value) =>
                          updateSignupVolunteerSheet("occupation", value)
                        }
                        editable={!signupLoading}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Workplace or School"
                        placeholderTextColor="#999"
                        value={signupVolunteerSheet.workplaceOrSchool}
                        onChangeText={(value) =>
                          updateSignupVolunteerSheet("workplaceOrSchool", value)
                        }
                        editable={!signupLoading}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="College Course"
                        placeholderTextColor="#999"
                        value={signupVolunteerSheet.collegeCourse}
                        onChangeText={(value) =>
                          updateSignupVolunteerSheet("collegeCourse", value)
                        }
                        editable={!signupLoading}
                      />
                      <Text style={styles.modalSectionSubLabel}>
                        Skills (Select all that apply)
                      </Text>
                      <View style={styles.dropdownWrap}>
                        <TouchableOpacity
                          style={styles.dropdownTrigger}
                          onPress={() => {
                            setShowSkillsDropdown((current) => !current);
                          }}
                          disabled={signupLoading}
                          activeOpacity={0.85}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.dropdownTriggerText,
                              signupVolunteerSheet.skills.length === 0 &&
                              styles.dropdownPlaceholder,
                            ]}
                            numberOfLines={2}
                          >
                            {signupVolunteerSheet.skills.length > 0
                              ? signupVolunteerSheet.skills.join(", ")
                              : "Select skills"}
                          </Text>
                          <MaterialIcons
                            name={
                              showSkillsDropdown
                                ? "keyboard-arrow-up"
                                : "keyboard-arrow-down"
                            }
                            size={22}
                            color="#475569"
                          />
                        </TouchableOpacity>
                        {showSkillsDropdown ? (
                          <View style={styles.dropdownMenu}>
                            {availableSkills.map((skill) => {
                              const isSelected =
                                signupVolunteerSheet.skills.includes(skill);
                              return (
                                <TouchableOpacity
                                  key={skill}
                                  style={[
                                    styles.dropdownOption,
                                    isSelected && styles.dropdownOptionSelected,
                                  ]}
                                  onPress={() =>
                                    handleToggleVolunteerSkill(skill)
                                  }
                                  disabled={signupLoading}
                                  activeOpacity={0.8}
                                  hitSlop={4}
                                >
                                  <MaterialIcons
                                    name={
                                      isSelected
                                        ? "check-box"
                                        : "check-box-outline-blank"
                                    }
                                    size={19}
                                    color={isSelected ? "#166534" : "#64748b"}
                                  />
                                  <Text
                                    style={[
                                      styles.dropdownOptionText,
                                      isSelected &&
                                      styles.dropdownOptionTextSelected,
                                    ]}
                                  >
                                    {skill}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.customSkillRow}>
                        <TextInput
                          style={styles.customSkillInput}
                          placeholder="Add custom skill"
                          placeholderTextColor="#9ca3af"
                          value={customVolunteerSkill}
                          onChangeText={setCustomVolunteerSkill}
                          onSubmitEditing={handleAddCustomVolunteerSkill}
                          returnKeyType="done"
                          editable={!signupLoading}
                        />
                        <TouchableOpacity
                          style={styles.customSkillAddButton}
                          onPress={handleAddCustomVolunteerSkill}
                          disabled={signupLoading}
                        >
                          <MaterialIcons name="add" size={18} color="#fff" />
                          <Text style={styles.customSkillAddButtonText}>
                            Add
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.modalSectionLabel}>
                        Certifications & Media
                      </Text>

                      <View style={styles.uploadActionsRow}>
                        <TouchableOpacity
                          style={[
                            styles.button,
                            styles.uploadButton,
                            signupLoading && { opacity: 0.6 },
                          ]}
                          onPress={handlePickVolunteerCertificate}
                          disabled={signupLoading}
                        >
                          <Text style={styles.uploadButtonText}>
                            {signupVolunteerSheet.certificationsOrTrainings
                              ? "Change Certificate Photo"
                              : "Upload Certificate Photo"}
                          </Text>
                        </TouchableOpacity>
                        {signupVolunteerSheet.certificationsOrTrainings ? (
                          <TouchableOpacity
                            style={[styles.button, styles.cancelUploadButton]}
                            onPress={() =>
                              updateSignupVolunteerSheet(
                                "certificationsOrTrainings",
                                "",
                              )
                            }
                            disabled={signupLoading}
                          >
                            <Text style={styles.cancelUploadButtonText}>
                              Cancel Upload
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <Text style={styles.certificateHelperText}>
                        Upload a clear photo of your certificate of training.
                      </Text>
                      {signupVolunteerSheet.certificationsOrTrainings ? (
                        <View style={styles.certificatePreviewCard}>
                          {isImageMediaUri(
                            signupVolunteerSheet.certificationsOrTrainings,
                          ) ? (
                            <Image
                              source={{
                                uri: signupVolunteerSheet.certificationsOrTrainings,
                              }}
                              style={styles.certificatePreviewImage as any}
                            />
                          ) : null}
                          <View style={styles.certificatePreviewFooter}>
                            <Text style={styles.certificatePreviewLabel}>
                              Certificate photo selected
                            </Text>
                            <TouchableOpacity
                              onPress={() =>
                                updateSignupVolunteerSheet(
                                  "certificationsOrTrainings",
                                  "",
                                )
                              }
                              disabled={signupLoading}
                            >
                              <Text style={styles.certificateRemoveText}>
                                Remove
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}

                      <Text style={styles.modalSectionSubLabel}>
                        Video Briefing
                      </Text>
                      <View style={styles.briefingVideoCard}>
                        <View style={styles.briefingVideoPreview}>
                          <MaterialIcons
                            name="play-circle-filled"
                            size={58}
                            color="#ffffff"
                          />
                          <Text style={styles.briefingVideoPreviewText}>
                            Placeholder video
                          </Text>
                        </View>
                        <Text style={styles.briefingVideoTitle}>
                          Volunteer orientation briefing
                        </Text>
                        <Text style={styles.briefingVideoDescription}>
                          Volunteers should finish watching the orientation
                          video before submitting registration. This placeholder
                          can be replaced with the final video later.
                        </Text>
                      </View>

                      <Text style={styles.modalSectionSubLabel}>
                        Affiliations (if any)
                      </Text>
                      <View style={styles.affiliationRow}>
                        <TextInput
                          style={[styles.input, styles.affiliationInput]}
                          placeholder="Organization"
                          placeholderTextColor="#999"
                          value={signupVolunteerSheet.affiliationOrg1}
                          onChangeText={(value) =>
                            updateSignupVolunteerSheet("affiliationOrg1", value)
                          }
                          editable={!signupLoading}
                        />
                        <TextInput
                          style={[styles.input, styles.affiliationInput]}
                          placeholder="Position"
                          placeholderTextColor="#999"
                          value={signupVolunteerSheet.affiliationPos1}
                          onChangeText={(value) =>
                            updateSignupVolunteerSheet("affiliationPos1", value)
                          }
                          editable={!signupLoading}
                        />
                      </View>
                      <Text style={styles.modalSectionLabel}>Commitment</Text>
                      <View style={styles.commitmentCard}>
                        <Text style={styles.commitmentParagraph}>
                          I{" "}
                          {signupName.trim() ||
                            "_______________________________"}
                          , voluntarily and freely commit myself to be a member
                          of the NVC Foundation, Inc. I believe in the
                          foundation's ideals, objectives and directions which
                          are aimed to fight hunger and poverty by providing
                          nutrition, access to quality education for children
                          and livelihood opportunities for the poor.
                        </Text>
                        <Text style={styles.commitmentParagraph}>
                          As a full pledged member, I have read the NVC's
                          volunteers manual and I commit:
                        </Text>
                        <Text style={styles.commitmentBullet}>
                          - To actively participate in the Foundation's projects
                          and activities.
                        </Text>
                        <Text style={styles.commitmentBullet}>
                          - To willingly work towards positive and peaceful
                          change.
                        </Text>
                        <Text style={styles.commitmentBullet}>
                          - To refrain from using one's personal participation
                          in NVC, or using NVC's collective activities, for
                          partisan politics, whether it be for personal
                          advantage or endorsement of any politician or
                          political party.
                        </Text>
                        <Text style={styles.commitmentBullet}>
                          - To insure that my personal interests do not conflict
                          with those of NVC's.
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.commitmentAcceptanceRow}
                        onPress={() =>
                          setSignupAcceptedCommitment((current) => !current)
                        }
                        disabled={signupLoading}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons
                          name={
                            signupAcceptedCommitment
                              ? "check-box"
                              : "check-box-outline-blank"
                          }
                          size={22}
                          color={
                            signupAcceptedCommitment ? "#166534" : "#64748b"
                          }
                        />
                        <Text style={styles.commitmentAcceptanceText}>
                          I have read and accept the NVC volunteer commitment.
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              )}

              {signupStep === "role" ? (
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalSecondaryButton}
                    onPress={closeSignupModal}
                  >
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalSecondaryButton}
                    onPress={() => {
                      if (signupRole === "admin") {
                        closeSignupModal();
                      } else {
                        setSignupStep("role");
                      }
                    }}
                    disabled={signupLoading}
                  >
                    <Text style={styles.modalSecondaryText}>
                      {signupRole === "admin" ? "Cancel" : "Back"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalPrimaryButton,
                      (signupLoading || !signupEmailVerified) && styles.buttonDisabled,
                    ]}
                    onPress={handleSignup}
                    disabled={signupLoading || !signupEmailVerified}
                  >
                    {signupLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.modalPrimaryText}>
                        {signupRole === "admin"
                          ? "Create Admin Account"
                          : signupRole === "partner"
                            ? "Submit Application"
                            : "Create Volunteer Account"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* Year Picker Modal */}
          {showYearPicker && (
            <Modal
              visible={showYearPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowYearPicker(false)}
            >
              <View style={styles.yearPickerOverlay}>
                <View style={styles.yearPickerModal}>
                  <View style={styles.yearPickerHeader}>
                    <Text style={styles.yearPickerTitle}>
                      Select Birth Year
                    </Text>
                    <TouchableOpacity onPress={() => setShowYearPicker(false)}>
                      <MaterialIcons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    ref={yearPickerListRef}
                    style={styles.yearPickerList}
                  >
                    {Array.from(
                      { length: 100 },
                      (_, i) => new Date().getFullYear() - i,
                    ).map((year) => (
                      <TouchableOpacity
                        key={year}
                        style={[
                          styles.yearPickerItem,
                          selectedYear === year &&
                          styles.yearPickerItemSelected,
                        ]}
                        onPress={() => {
                          setSelectedYear(year);
                          const newDate = new Date(selectedDate);
                          newDate.setFullYear(year);
                          setSelectedDate(newDate);
                          setShowYearPicker(false);
                          setShowDatePicker(true);
                        }}
                      >
                        <Text
                          style={[
                            styles.yearPickerItemText,
                            selectedYear === year &&
                            styles.yearPickerItemTextSelected,
                          ]}
                        >
                          {year}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TouchableOpacity
                    style={styles.yearPickerCancel}
                    onPress={() => setShowYearPicker(false)}
                  >
                    <Text style={styles.yearPickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}

          {/* Date Picker Modal */}
          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={getPlatformOS() === "ios" ? "spinner" : "default"}
              onChange={(event: unknown, date: Date | undefined) => {
                if (getPlatformOS() === "android") {
                  setShowDatePicker(false);
                }
                if (date) {
                  setSelectedDate(date);
                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, "0");
                  const day = String(date.getDate()).padStart(2, "0");
                  updateSignupVolunteerSheet(
                    "dateOfBirth",
                    `${year}-${month}-${day}`,
                  );
                }
              }}
              maximumDate={new Date()}
            />
          )}

          {/* iOS Date Picker Close Button */}
          {getPlatformOS() === "ios" && showDatePicker && (
            <View style={styles.iosDatePickerActions}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.iosDatePickerButton}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ModernTheme.colors.neutral[100],
  },
  webBackgroundImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  webDarkOverlay: {
    flex: 1,
    backgroundColor: "rgba(5, 20, 12, 0.45)",
  },
  webOuterContainer: {
    backgroundColor: "transparent",
  },
  contentContainer: {
    flexGrow: 1,
    padding: ModernTheme.spacing[5],
    justifyContent: "flex-start",
  },
  webContentContainer: {
    minHeight: "100vh" as any,
    paddingVertical: ModernTheme.spacing[10],
    paddingHorizontal: ModernTheme.spacing[14],
    justifyContent: "center",
  },
  compactContentContainer: {
    paddingHorizontal: ModernTheme.spacing[3.5],
    paddingVertical: ModernTheme.spacing[4],
  },
  contentShell: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  pageWrapper: {
    width: "100%",
    alignSelf: "center",
  },
  webPage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 40,
    maxWidth: 1200,
  },
  webPageStacked: {
    flexDirection: "column",
  },
  webHeroPane: {
    flex: 1.2,
    maxWidth: 640,
    paddingVertical: 24,
    paddingRight: 20,
  },
  webHeroEyebrow: {
    color: "#a3f7c4",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 16,
  },
  webHeroHeading: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "900",
    lineHeight: 56,
    marginBottom: 20,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  webHeroText: {
    color: "#f0fdf4",
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 20,
    maxWidth: 620,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  webHeroNote: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 22,
  },
  webCardShell: {
    width: "100%",
    maxWidth: 520,
    minWidth: 360,
    borderRadius: ModernTheme.borderRadius['3xl'],
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    padding: ModernTheme.spacing[7],
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
    ...ModernTheme.shadows.lg,
    // @ts-ignore React Native Web glass effect
    backdropFilter: "blur(24px)",
    // @ts-ignore React Native Web glass effect
    WebkitBackdropFilter: "blur(24px)",
  },
  webCardShellStacked: {
    width: "100%",
    paddingHorizontal: 20,
  },
  mobileContentShell: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  compactContentShell: {
    paddingTop: 14,
    paddingBottom: 18,
  },
  webContentShell: {
    width: "100%",
    paddingTop: 32,
    paddingBottom: 32,
  },
  brandSection: {
    alignItems: "center",
    marginBottom: 12,
  },
  leftBrandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 24,
  },
  leftBrandTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  pillBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(236, 253, 245, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(236, 253, 245, 0.4)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 20,
  },
  pillBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#a7ff83",
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginTop: 18,
    marginBottom: 8,
    textAlign: "center",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 30,
  },
  webAccessNotice: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  webAccessNoticeTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 4,
  },
  webAccessNoticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
  },
  selectionDashboard: {
    gap: 14,
    marginBottom: 20,
  },
  selectionTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "center",
  },
  selectionSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: "#475569",
    textAlign: "center",
  },
  selectionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 18,
    padding: 18,
  },
  selectionCardStacked: {
    flexDirection: "column",
  },
  selectionCardPartner: {
    backgroundColor: "#fffbeb",
    borderColor: "#fcd34d",
  },
  selectionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  selectionIconWrapPartner: {
    backgroundColor: "#fef3c7",
  },
  selectionCopy: {
    flex: 1,
  },
  selectionCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
  },
  selectionCardDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
  },
  selectionCardAction: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
  },
  selectionCardActionPartner: {
    color: "#92400e",
  },
  backendStatusCard: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  backendStatusChecking: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
  },
  backendStatusOnline: {
    backgroundColor: "#ecfdf5",
    borderColor: "#bbf7d0",
  },
  backendStatusOffline: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  backendStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backendStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  backendStatusDotChecking: {
    backgroundColor: "#2563eb",
  },
  backendStatusDotOnline: {
    backgroundColor: "#16a34a",
  },
  backendStatusDotOffline: {
    backgroundColor: "#dc2626",
  },
  backendStatusTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
  },
  backendStatusText: {
    marginTop: 8,
    fontSize: 12,
    color: "#475569",
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#ddd",
    fontSize: 16,
    minHeight: 54,
  },
  signupOtpBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 12,
    padding: 12,
    marginTop: -4,
    marginBottom: 15,
  },
  signupOtpHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  signupOtpTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: "#334155",
  },
  signupOtpButton: {
    backgroundColor: "#16a34a",
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  signupOtpButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },
  signupOtpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  signupOtpInput: {
    flex: 1,
    marginBottom: 0,
    textAlign: "center",
    letterSpacing: 3,
    fontWeight: "800",
  },
  signupOtpVerifyButton: {
    borderWidth: 1,
    borderColor: "#16a34a",
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ecfdf5",
  },
  signupOtpVerifyText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "800",
  },
  signupOtpMessage: {
    marginTop: 8,
    fontSize: 12,
    color: "#475569",
  },
  signupOtpMessageSuccess: {
    color: "#166534",
    fontWeight: "700",
  },
  compactInput: {
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#4CAF50",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 20,
    minHeight: 50,
    justifyContent: "center",
  },
  compactButton: {
    marginTop: 16,
    minHeight: 48,
  },
  buttonDisabled: {
    backgroundColor: "#999",
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  demoSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#4CAF50",
  },
  demoTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  demoItem: {
    marginBottom: 12,
  },
  demoLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  demoEmail: {
    fontSize: 13,
    color: "#333",
    fontFamily: "monospace",
    marginBottom: 2,
  },
  demoPassword: {
    fontSize: 13,
    color: "#333",
    fontFamily: "monospace",
  },
  mobileOnlyCard: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  mobileOnlyBadge: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
  },
  mobileRoleBanner: {
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbeafe",
    padding: 14,
    marginBottom: 16,
  },
  backToRoleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  backToRoleText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
  },
  mobileRoleBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  mobileRoleBannerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f172a",
  },
  mobileRoleBannerText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
  },
  savedAccountCard: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  accountCardDisabled: {
    opacity: 0.65,
  },
  savedAccountHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 6,
  },
  savedAccountName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  savedAccountRole: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
    textTransform: "uppercase",
    alignSelf: "flex-start",
  },
  savedAccountCredential: {
    fontSize: 13,
    color: "#334155",
    fontFamily: "monospace",
    marginBottom: 2,
  },
  savedAccountPassword: {
    fontSize: 13,
    color: "#334155",
    fontFamily: "monospace",
  },
  savedAccountHint: {
    marginTop: 6,
    fontSize: 12,
    color: "#64748b",
  },
  signupText: {
    color: "#4CAF50",
    textAlign: "center",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 14,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    flex: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 6,
    marginBottom: 14,
  },
  modalForm: {
    maxHeight: 560,
  },
  modalFormContent: {
    paddingBottom: 24,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
  },
  fieldHelpText: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
    lineHeight: 18,
  },
  modalSectionSubLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 8,
  },
  roleSelector: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    marginBottom: 16,
  },
  signupRoleChoiceGrid: {
    gap: 14,
    marginBottom: 16,
  },
  signupRoleCard: {
    borderWidth: 2,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 16,
    minHeight: 120,
    justifyContent: "flex-start",
  },
  signupRoleCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  signupRoleCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  signupRoleCardDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
  },
  signupRoleCardAction: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
  },
  pillarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  pillarChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
  },
  pillarChipActive: {
    backgroundColor: "#166534",
  },
  pillarChipText: {
    color: "#475569",
    fontWeight: "700",
  },
  pillarChipTextActive: {
    color: "#fff",
  },
  partnerLockNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  partnerLockNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#78350f",
    fontWeight: "600",
  },
  affiliationRow: {
    flexDirection: "row",
    gap: 10,
  },
  affiliationInput: {
    flex: 1,
  },
  commitmentCard: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  commitmentParagraph: {
    fontSize: 13,
    lineHeight: 21,
    color: "#334155",
    marginBottom: 10,
  },
  commitmentBullet: {
    fontSize: 13,
    lineHeight: 21,
    color: "#334155",
    marginBottom: 8,
  },
  commitmentAcceptanceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 16,
  },
  commitmentAcceptanceText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: "#334155",
    fontWeight: "600",
  },
  roleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
  },
  roleChipActive: {
    backgroundColor: "#4CAF50",
  },
  roleChipText: {
    color: "#475569",
    fontWeight: "700",
  },
  roleChipTextActive: {
    color: "#fff",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalSecondaryText: {
    color: "#475569",
    fontWeight: "700",
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#4CAF50",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalPrimaryText: {
    color: "#fff",
    fontWeight: "700",
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
    marginTop: 16,
    textAlign: "center",
  },
  textArea: {
    minHeight: 80,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  uploadButton: {
    flex: 1,
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#0ea5e9",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  uploadButtonText: {
    color: "#0369a1",
    fontWeight: "600",
    fontSize: 14,
  },
  uploadActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginBottom: 12,
  },
  cancelUploadButton: {
    flex: 1,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 12,
  },
  cancelUploadButtonText: {
    color: "#991b1b",
    fontWeight: "700",
    fontSize: 14,
  },
  certificateHelperText: {
    marginTop: 8,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
  },
  certificatePreviewCard: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  certificatePreviewImage: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    backgroundColor: "#e2e8f0",
    marginBottom: 10,
  },
  certificatePreviewFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  certificatePreviewLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
  },
  certificateRemoveText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#dc2626",
  },
  briefingVideoCard: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  briefingVideoPreview: {
    height: 180,
    borderRadius: 12,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  briefingVideoPreviewText: {
    marginTop: 8,
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
  },
  briefingVideoTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 6,
  },
  briefingVideoDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: "#475569",
  },
  locationField: {
    marginBottom: 0,
  },
  phLocationInput: {
    marginBottom: 12,
  },
  genderGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  genderChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  genderChipActive: {
    backgroundColor: "#4CAF50",
    borderColor: "#2e7d32",
  },
  genderChipText: {
    color: "#475569",
    fontWeight: "600",
    fontSize: 14,
  },
  genderChipTextActive: {
    color: "#fff",
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  statusChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#e2e8f0",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  statusChipActive: {
    backgroundColor: "#4CAF50",
    borderColor: "#2e7d32",
  },
  statusChipText: {
    color: "#475569",
    fontWeight: "600",
    fontSize: 13,
  },
  statusChipTextActive: {
    color: "#fff",
  },
  datePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#3b82f6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 12,
  },
  datePickerButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 12,
    backgroundColor: "#f8fafc",
  },
  picker: {
    height: 50,
    color: "#334155",
  },
  iosDatePickerActions: {
    backgroundColor: "#e2e8f0",
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iosDatePickerButton: {
    color: "#4CAF50",
    fontWeight: "600",
    fontSize: 16,
    paddingHorizontal: 16,
  },
  yearPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
    paddingBottom: 40,
  },
  yearPickerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingTop: 16,
    paddingBottom: 16,
  },
  yearPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  yearPickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e293b",
  },
  yearPickerList: {
    paddingHorizontal: 20,
    marginVertical: 16,
  },
  yearPickerItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
  },
  yearPickerItemSelected: {
    backgroundColor: "#4CAF50",
  },
  yearPickerItemText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#64748b",
  },
  yearPickerItemTextSelected: {
    color: "#fff",
    fontWeight: "700",
  },
  yearPickerCancel: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  yearPickerCancelText: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: "#64748b",
  },
  skillsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  dropdownWrap: {
    marginBottom: 12,
  },
  dropdownTrigger: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  dropdownTriggerDisabled: {
    opacity: 0.55,
  },
  dropdownTriggerText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: "#0f172a",
  },
  dropdownPlaceholder: {
    color: "#94a3b8",
  },
  dropdownMenu: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#fff",
    overflow: "hidden",
    marginBottom: 8,
    maxHeight: 300,
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  dropdownOptionSelected: {
    backgroundColor: "#f0fdf4",
  },
  dropdownOptionText: {
    flex: 1,
    fontSize: 14,
    color: "#334155",
  },
  dropdownOptionTextSelected: {
    color: "#166534",
    fontWeight: "700",
  },
  skillChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#e2e8f0",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  skillChipActive: {
    backgroundColor: "#4CAF50",
    borderColor: "#2e7d32",
  },
  skillChipText: {
    color: "#475569",
    fontWeight: "600",
    fontSize: 12,
  },
  skillChipTextActive: {
    color: "#fff",
  },
  customSkillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  customSkillInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingHorizontal: 12,
    fontSize: 13,
    color: "#0f172a",
    backgroundColor: "#fff",
  },
  customSkillAddButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#4CAF50",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  customSkillAddButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
