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
import { format, parseISO } from "date-fns";
import ModernTheme from "../utils/modernTheme";
import loginBackgroundImage from "../assets/about-us-2020.jpg";

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
import { MaterialIcons } from '@expo/vector-icons';
import { Picker } from "@react-native-picker/picker";
import {
  createUserAccount,
  getAllProjects,
  getAllUsers,
  getApiBaseUrl,
  getStorageItemFast,
  getUserByEmailOrPhone,
  validateDswdAccreditationNo,
  loginWithCredentials,
  saveAppSettings,
  setRuntimeBackendUrl,
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
  validIdPhoto: string;
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

type RegistrationOtpPhase = "idle" | "sent" | "expired" | "verified";

function getPasswordValidationMessage(password: string): string | null {
  const trimmedPassword = password.trim();
  if (trimmedPassword.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(trimmedPassword)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(trimmedPassword)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/\d/.test(trimmedPassword)) {
    return "Password must include at least one number.";
  }
  return null;
}

function isDuplicateEmailErrorMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("email already exists") ||
    normalizedMessage.includes("account with this email already exists") ||
    normalizedMessage.includes("already registered")
  );
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
    validIdPhoto: "",
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

function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalizeNameInput(value: string): string {
  return toTitleCase(value);
}

function normalizeProfessionalInput(value: string): string {
  return toTitleCase(value);
}

function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

function normalizeLoginPhone(value?: string): string {
  return (value || "").replace(/\D/g, "");
}

function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
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
  const stackSelectionCards = screenWidth < 600;
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
  const [signupValidationError, setSignupValidationError] = useState<string | null>(null);
  const [signupSuccessData, setSignupSuccessData] = useState<{
    title: string;
    message: string;
    role: UserRole;
    name: string;
    organizationName?: string;
    contact: string;
    submittedAt: string;
  } | null>(null);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupEmailForOtp, setSignupEmailForOtp] = useState("");
  const [signupOtpCode, setSignupOtpCode] = useState("");
  const [signupOtpPhase, setSignupOtpPhase] =
    useState<RegistrationOtpPhase>("idle");
  const [otpSecondsLeft, setOtpSecondsLeft] = useState<number>(0);
  const [signupOtpLoading, setSignupOtpLoading] = useState(false);
  const [signupOtpAction, setSignupOtpAction] =
    useState<"send" | "verify" | null>(null);
  const [signupAccountPhone, setSignupAccountPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
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
  const [emailExistsError, setEmailExistsError] = useState<string | null>(null);
  const emailCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverUrlSaving, setServerUrlSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
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

  useEffect(() => {
    setInitialized(true);
    setLoading(false);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (signupVolunteerSheet.dateOfBirth) {
      const parsedDate = parseISO(signupVolunteerSheet.dateOfBirth);
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

  const selectedDay = selectedDate.getDate();

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
    if (signupOtpPhase !== "sent") {
      return undefined;
    }

    if (otpSecondsLeft <= 0) {
      setSignupOtpPhase("expired");
      setOtpSecondsLeft(0);
      return undefined;
    }

    const otpTimer = setTimeout(() => {
      setOtpSecondsLeft((secondsLeft) => Math.max(0, secondsLeft - 1));
    }, 1000);

    return () => clearTimeout(otpTimer);
  }, [otpSecondsLeft, signupOtpPhase]);

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
          headers: {
            'ngrok-skip-browser-warning': '69420',
            'User-Agent': 'VolCre-App/1.0',
            'Accept': 'application/json',
          },
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

      if (!isWeb && user.role === "admin") {
        showLoginError(
          "Access Restricted",
          "Admin accounts can only log in on the web portal.",
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

      if (!isWeb && user.role === "admin") {
        showLoginError(
          "Access Restricted",
          "Admin accounts can only log in on the web portal.",
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

  // Clears all signup fields after registration or when the modal is closed.
  const resetSignupForm = () => {
    setSignupName("");
    setSignupEmail("");
    setSignupEmailForOtp("");
    setSignupOtpCode("");
    setSignupOtpPhase("idle");
    setOtpSecondsLeft(0);
    setSignupOtpLoading(false);
    setSignupOtpAction(null);
    setSignupAccountPhone("");
    setSignupPassword("");
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

  const updateSignupEmail = (value: string) => {
    setSignupEmail(value);
    setSignupValidationError(null);
    setEmailExistsError(null);
    const normalizedEmail = normalizeEmailInput(value);
    if (
      signupOtpPhase !== "idle" &&
      normalizedEmail !== normalizeEmailInput(signupEmailForOtp)
    ) {
      setSignupOtpCode("");
      setSignupOtpPhase("idle");
      setOtpSecondsLeft(0);
    }
    // Debounce email duplicate check
    if (emailCheckTimerRef.current) {
      clearTimeout(emailCheckTimerRef.current);
    }
    if (normalizedEmail && normalizedEmail.includes("@")) {
      emailCheckTimerRef.current = setTimeout(async () => {
        try {
          const response = await fetch(
            `${getApiBaseUrl()}/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`,
            {
              headers: {
                "ngrok-skip-browser-warning": "69420",
                "User-Agent": "VolCre-App/1.0",
                "Accept": "application/json",
              },
            }
          );
          if (response.ok) {
            const data = (await response.json()) as { exists?: boolean; message?: string };
            if (data.exists) {
              setEmailExistsError(data.message || "An account with this email already exists.");
            } else {
              setEmailExistsError(null);
            }
          }
        } catch {
          // Ignore network errors for this check
        }
      }, 700);
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

  const handlePickValidIdPhoto = async () => {
    try {
      const selectedImage = await pickImageFromDevice();
      if (!selectedImage) {
        return;
      }

      updateSignupVolunteerSheet("validIdPhoto", selectedImage);
    } catch (error: any) {
      Alert.alert(
        "ID Upload Failed",
        error?.message ||
        "Unable to open the photo library for ID upload.",
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

  const requestSignupEmailVerificationCode = async () => {
    const email = normalizeEmailInput(signupEmail);
    setSignupValidationError(null);

    if (!email || !email.includes("@")) {
      const errorMsg = "Enter a valid email address before requesting a verification code.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    try {
      setSignupOtpLoading(true);
      setSignupOtpAction("send");
      const existingUsers = await getAllUsers();
      const emailAlreadyRegistered = existingUsers.some(
        (user) => normalizeEmailInput(user.email || "") === email,
      );
      if (emailAlreadyRegistered) {
        setEmailExistsError("An account with this email already exists.");
        throw new Error("An account with this email already exists.");
      }

      // Check backend email availability
      try {
        const checkRes = await fetch(
          `${getApiBaseUrl()}/auth/check-email?email=${encodeURIComponent(email)}`,
          {
            headers: {
              "ngrok-skip-browser-warning": "69420",
              "User-Agent": "VolCre-App/1.0",
              "Accept": "application/json",
            },
          },
        );
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as {
            exists?: boolean;
            message?: string;
          };
          if (checkData.exists) {
            const msg = checkData.message || "An account with this email already exists.";
            setEmailExistsError(msg);
            throw new Error(msg);
          }
        }
      } catch (checkErr: any) {
        if (isDuplicateEmailErrorMessage(checkErr?.message || "")) {
          throw checkErr;
        }
      }

      const response = await fetch(`${getApiBaseUrl()}/auth/registration-otp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
          "User-Agent": "VolCre-App/1.0",
          "Accept": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
        dev_otp?: string;
        expires_in?: number;
      };

      if (!response.ok) {
        if (isDuplicateEmailErrorMessage(payload.detail || "")) {
          setEmailExistsError(payload.detail || "An account with this email already exists.");
        }
        throw new Error(payload.detail || "Unable to send verification code.");
      }

      setSignupEmailForOtp(email);
      setSignupOtpCode(payload.dev_otp || "");
      setOtpSecondsLeft(payload.expires_in || 300);
      setSignupOtpPhase("sent");
      Alert.alert(
        "Verification Code Sent",
        payload.dev_otp
          ? `Your verification code is: ${payload.dev_otp}\n\nValid for 5 minutes.`
          : payload.message || "Check your email inbox for the 6-digit code (valid for 5 minutes)."
      );
    } catch (error) {
      const errMsg = getRequestErrorMessage(error, "Unable to send verification code.", {
        backendUrl: getApiBaseUrl(),
      });
      if (isDuplicateEmailErrorMessage(errMsg)) {
        setEmailExistsError(errMsg);
        setSignupOtpPhase("idle");
        setOtpSecondsLeft(0);
        setSignupOtpCode("");
      }
      setSignupValidationError(errMsg);
      Alert.alert(
        isDuplicateEmailErrorMessage(errMsg) ? "Email Already Registered" : "Verification Error",
        errMsg,
      );
    } finally {
      setSignupOtpLoading(false);
      setSignupOtpAction(null);
    }
  };

  const verifySignupEmailCode = async () => {
    const email = normalizeEmailInput(signupEmail);
    const otp = signupOtpCode.trim();
    setSignupValidationError(null);

    if (!email || !email.includes("@")) {
      const errorMsg = "Enter the email address that received the code.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (email !== normalizeEmailInput(signupEmailForOtp)) {
      const errorMsg = "Request a new verification code for this email address.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupOtpPhase === "expired" || otpSecondsLeft <= 0) {
      const errorMsg = "Your verification code has expired. Please request a new code.";
      setSignupOtpPhase("expired");
      setOtpSecondsLeft(0);
      setSignupValidationError(errorMsg);
      Alert.alert("Code Expired", errorMsg);
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      const errorMsg = "Enter the 6-digit verification code sent to your email.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    try {
      setSignupOtpLoading(true);
      setSignupOtpAction("verify");
      const response = await fetch(`${getApiBaseUrl()}/auth/registration-otp/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "69420",
          "User-Agent": "VolCre-App/1.0",
          "Accept": "application/json",
        },
        body: JSON.stringify({ email, otp }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.detail || "Unable to verify email code.");
      }

      setSignupOtpPhase("verified");
      setOtpSecondsLeft(0);
      Alert.alert("Email Verified", payload.message || "Your email address has been verified.");
    } catch (error) {
      const errMsg = getRequestErrorMessage(error, "Unable to verify email code.", {
        backendUrl: getApiBaseUrl(),
      });
      if (errMsg.toLowerCase().includes("verification code has expired")) {
        setSignupOtpPhase("expired");
        setOtpSecondsLeft(0);
      }
      setSignupValidationError(errMsg);
      Alert.alert("Verification Error", errMsg);
    } finally {
      setSignupOtpLoading(false);
      setSignupOtpAction(null);
    }
  };

  // Validates and creates a new volunteer or partner account.
  const handleSignup = async () => {
    setSignupValidationError(null);

    if (!signupName.trim() || !signupPassword.trim()) {
      const errorMsg = "Name and password are required.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupName.trim().length < 2) {
      const errorMsg = "Full name must be at least 2 characters long.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupPassword.length < 6) {
      const errorMsg = "Password must be at least 6 characters.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    const passwordValidationMessage =
      signupRole === "partner" || signupRole === "volunteer"
        ? getPasswordValidationMessage(signupPassword)
        : null;
    if (passwordValidationMessage) {
      setSignupValidationError(passwordValidationMessage);
      Alert.alert("Weak Password", passwordValidationMessage);
      return;
    }

    if (
      signupAccountPhone.trim() &&
      !/^09\d{9}$/.test(signupAccountPhone.trim())
    ) {
      const errorMsg = "Please enter a valid 11-digit Philippine mobile number (e.g. 09171234567).";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupRole !== "admin" && !signupEmail.trim()) {
      const errorMsg = "Email verification is required for volunteer and partner registration.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (!signupEmail.trim() && !signupAccountPhone.trim()) {
      const errorMsg = "Please provide an email or phone number.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupEmail.trim() && !signupEmail.includes("@")) {
      const errorMsg = "Please enter a valid email address.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (
      signupRole !== "admin" &&
      (signupOtpPhase !== "verified" ||
        normalizeEmailInput(signupEmail) !== normalizeEmailInput(signupEmailForOtp))
    ) {
      const errorMsg = "Verify your email address with the 6-digit code before submitting.";
      setSignupValidationError(errorMsg);
      Alert.alert("Validation Error", errorMsg);
      return;
    }

    if (signupRole === "partner") {
      if (!signupPartnerApplication.organizationName.trim()) {
        const errorMsg = "Organization name is required.";
        setSignupValidationError(errorMsg);
        Alert.alert("Validation Error", errorMsg);
        return;
      }

      if (signupPartnerApplication.advocacyFocus.length === 0) {
        const errorMsg = "Select at least one advocacy focus.";
        setSignupValidationError(errorMsg);
        Alert.alert("Validation Error", errorMsg);
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
        const errorMsg = "Complete the volunteer membership information sheet before creating the account.";
        setSignupValidationError(errorMsg);
        Alert.alert("Validation Error", errorMsg);
        return;
      }

      if (!signupAcceptedCommitment) {
        const errorMsg = "You must accept the NVC volunteer commitment before creating the account.";
        setSignupValidationError(errorMsg);
        Alert.alert("Validation Error", errorMsg);
        return;
      }
    }

    try {
      setSignupLoading(true);
      
      // Allow visual loading modal to be clearly seen
      await new Promise((resolve) => setTimeout(resolve, 1400));

      const createdUser = await createUserAccount({
        name: signupName,
        email: signupEmail,
        password: signupPassword,
        phone: normalizePhoneInput(signupAccountPhone),
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
                  stakeholderName: signupName.trim(),
                  sectorType: signupPartnerApplication.sectorType,
                  dswdAccreditationNo:
                    signupPartnerApplication.dswdAccreditationNo?.trim() || "",
                  secRegistrationNo:
                    signupPartnerApplication.secRegistrationNo?.trim() || "",
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
              validIdPhoto: signupVolunteerSheet.validIdPhoto.trim(),
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

      
      const successTitle =
        signupRole === "admin"
          ? "Admin Account Created"
          : "Confirmed Registration";
      const successMessage =
        signupRole === "admin"
          ? "The new admin account is ready to sign in on the web portal."
          : signupRole === "partner"
            ? "Your partner application was successfully submitted. An admin must verify and approve it before partner login is unlocked."
            : "Confirmed Registration. Your application has been sent to Volunteer Management for approval.";

      const applicantName = signupName.trim();
      const applicantOrg = signupRole === "partner" ? signupPartnerApplication.organizationName.trim() : undefined;
      const applicantContact = signupEmail.trim() || signupAccountPhone.trim();

      setSignupSuccessData({
        title: successTitle,
        message: successMessage,
        role: signupRole,
        name: applicantName,
        organizationName: applicantOrg,
        contact: applicantContact,
        submittedAt: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
    } catch (error) {
      const errMsg = getRequestErrorMessage(error, "Failed to create account.", {
        backendUrl: getApiBaseUrl(),
      });
      const errorTitle = isDuplicateEmailErrorMessage(errMsg)
        ? "Email Already Registered"
        : getRequestErrorTitle(error, "Sign Up Error");
      setSignupValidationError(errMsg);
      Alert.alert(
        errorTitle,
        errMsg,
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
  const signupPasswordValidationMessage =
    signupRole === "partner" || signupRole === "volunteer"
      ? getPasswordValidationMessage(signupPassword)
      : null;
  const renderSignupEmailVerificationControls = () => {
    if (signupRole === "admin") {
      return null;
    }

    const normalizedEmail = normalizeEmailInput(signupEmail);
    const isVerified =
      signupOtpPhase === "verified" &&
      normalizedEmail === normalizeEmailInput(signupEmailForOtp);
    const isExpired = signupOtpPhase === "expired";
    const canRequestCode =
      Boolean(normalizedEmail) &&
      normalizedEmail.includes("@") &&
      !emailExistsError &&
      !signupLoading &&
      !signupOtpLoading;
    const canVerifyCode =
      signupOtpPhase === "sent" &&
      otpSecondsLeft > 0 &&
      /^\d{6}$/.test(signupOtpCode.trim()) &&
      !signupLoading &&
      !signupOtpLoading;

    const formatTimeLeft = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    return (
      <View style={styles.emailVerificationCard}>
        <View style={styles.emailVerificationHeader}>
          <MaterialIcons
            name={isVerified ? "verified" : isExpired ? "error-outline" : emailExistsError ? "error" : "mark-email-unread"}
            size={18}
            color={isVerified ? "#166534" : (isExpired || emailExistsError) ? "#dc2626" : "#475569"}
          />
          <Text style={[styles.emailVerificationTitle, (isExpired || emailExistsError) && { color: "#dc2626" }]}>
            {isVerified ? "Email Verified" : isExpired ? "Verification Code Expired" : emailExistsError ? "Email Already Registered" : "Email Verification Required"}
          </Text>
        </View>
        <Text style={styles.emailVerificationText}>
          {isVerified
            ? `Verified ${signupEmailForOtp}.`
            : emailExistsError
              ? emailExistsError
              : isExpired
                ? "Your 6-digit code has expired. Please tap 'Resend Verification Code' to get a new code."
                : "Send a 6-digit code to this email and verify it before submitting (valid for 5 minutes)."}
        </Text>
        {!isVerified ? (
          <>
            {!emailExistsError ? (
              <View style={styles.emailVerificationActions}>
                <TextInput
                  style={[styles.input, styles.otpInput, isExpired && { borderColor: "#fca5a5" }]}
                  placeholder="6-digit code"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={signupOtpCode}
                  onChangeText={(value) =>
                    setSignupOtpCode(value.replace(/\D/g, "").slice(0, 6))
                  }
                  editable={!signupLoading && !signupOtpLoading && signupOtpPhase === "sent"}
                />
                <TouchableOpacity
                  style={[
                    styles.otpActionButton,
                    (!canVerifyCode || signupOtpLoading) && styles.buttonDisabled,
                  ]}
                  onPress={verifySignupEmailCode}
                  disabled={!canVerifyCode || signupOtpLoading}
                >
                  {signupOtpLoading && signupOtpAction === "verify" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.otpActionButtonText}>Verify</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {signupOtpPhase === "sent" && otpSecondsLeft > 0 ? (
              <Text style={styles.otpTimerText}>
                ⏱️ Code expires in {formatTimeLeft(otpSecondsLeft)}
              </Text>
            ) : null}

            {isExpired ? (
              <View style={styles.otpExpiredContainer}>
                <Text style={styles.otpExpiredText}>
                  ⚠️ Code expired. Request a new code below.
                </Text>
              </View>
            ) : null}

            {emailExistsError ? (
              <View style={styles.otpExpiredContainer}>
                <Text style={styles.otpExpiredText}>
                  ⚠️ {emailExistsError}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.otpSendButton,
                (!canRequestCode || signupOtpLoading) && styles.otpSendButtonDisabled,
              ]}
              onPress={requestSignupEmailVerificationCode}
              disabled={!canRequestCode || signupOtpLoading}
            >
              {signupOtpLoading && signupOtpAction === "send" ? (
                <ActivityIndicator color="#166534" />
              ) : (
                <Text style={styles.otpSendButtonText}>
                  {signupOtpPhase === "sent"
                    ? "Resend Verification Code"
                    : isExpired
                      ? "Request New Verification Code"
                      : "Send Verification Code"}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    );
  };

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
          source={loginBackgroundImage}
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
                <AppLogo width={160} />
              </View>
              <View style={styles.pillBadge}>
                <Text style={styles.pillBadgeText}>NVC FOUNDATION</Text>
              </View>
              <Text style={styles.webHeroHeadingOriginal}>
                A nation free from hunger and poverty,
              </Text>
              <Text style={styles.webHeroSubHeadingOriginal}>
                built through personal social responsibility and collaborative partnerships.
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
                <AppLogo width={220} />
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
              <View style={styles.mobilePortalContainer}>
                {/* Top Nav Bar */}
                <View style={styles.mobileTopBar}>
                  <View style={{ flex: 1 }} />
                  <View style={styles.mobileTopHelpRow}>
                    <MaterialIcons name="auto-awesome" size={13} color="#166534" style={{ marginRight: 4 }} />
                    <Text style={styles.mobileTopHelpText}>New here? Choose a portal to begin</Text>
                  </View>
                </View>

                {/* Main Header */}
                <View style={styles.portalHeroHeader}>
                  <Text style={styles.portalEyebrow}>GET STARTED</Text>
                  <Text style={styles.portalHeadline}>Choose Your Mobile Portal</Text>
                  <Text style={styles.portalSubtext}>
                    Select whether you are signing in as a volunteer or a partner organization before continuing.
                  </Text>
                </View>

                {/* Cards Grid */}
                <View style={[styles.portalGridContainer, stackSelectionCards && styles.portalGridContainerStacked]}>
                  {/* Volunteer Card */}
                  <View style={styles.portalTileCard}>
                    <View style={styles.volunteerBadgeIconWrap}>
                      <MaterialIcons name="volunteer-activism" size={24} color="#e11d48" />
                    </View>
                    <Text style={styles.portalTileTitle}>Volunteer</Text>
                    <Text style={styles.portalTileDescription}>
                      Join projects, track your hours, and manage your volunteer activities.
                    </Text>
                    <TouchableOpacity
                      style={styles.portalTileButton}
                      onPress={() => handleSelectMobileRole("volunteer")}
                      activeOpacity={0.88}
                    >
                      <Text style={styles.portalTileButtonText}>Continue as Volunteer</Text>
                      <MaterialIcons name="arrow-forward" size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  {/* Partner Organization Card */}
                  <View style={styles.portalTileCard}>
                    <View style={styles.partnerBadgeIconWrap}>
                      <MaterialIcons name="domain" size={24} color="#2563eb" />
                    </View>
                    <Text style={styles.portalTileTitle}>Partner Organization</Text>
                    <Text style={styles.portalTileDescription}>
                      Coordinate organization projects, submit reports, and collaborate with NVC.
                    </Text>
                    <TouchableOpacity
                      style={styles.portalTileButton}
                      onPress={() => handleSelectMobileRole("partner")}
                      activeOpacity={0.88}
                    >
                      <Text style={styles.portalTileButtonText}>Continue as Partner Organization</Text>
                      <MaterialIcons name="arrow-forward" size={16} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Bottom Sign up link */}
                <TouchableOpacity
                  style={styles.portalSignupFooter}
                  onPress={openSignupModal}
                  activeOpacity={0.8}
                >
                  <Text style={styles.portalSignupFooterText}>
                    Sign up as a Volunteer or Partner
                  </Text>
                </TouchableOpacity>

                {/* Server Settings gear button */}
                <TouchableOpacity
                  style={styles.serverSettingsButton}
                  onPress={() => {
                    setServerUrlInput(getApiBaseUrl());
                    setShowServerModal(true);
                  }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="settings" size={14} color="#94a3b8" />
                  <Text style={styles.serverSettingsButtonText}>Server Settings</Text>
                </TouchableOpacity>

                {/* Server URL Modal */}
                <Modal
                  visible={showServerModal}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowServerModal(false)}
                >
                  <View style={styles.serverModalOverlay}>
                    <View style={styles.serverModalCard}>
                      <Text style={styles.serverModalTitle}>⚙ Backend Server URL</Text>
                      <Text style={styles.serverModalDesc}>
                        Paste your ngrok URL or local IP. Leave blank to use the built-in default.
                        {"\n"}Example: https://abc123.ngrok-free.app
                      </Text>
                      <TextInput
                        style={styles.serverModalInput}
                        value={serverUrlInput}
                        onChangeText={setServerUrlInput}
                        placeholder="https://abc123.ngrok-free.app"
                        placeholderTextColor="#94a3b8"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      <View style={styles.serverModalButtons}>
                        <TouchableOpacity
                          style={styles.serverModalCancel}
                          onPress={() => setShowServerModal(false)}
                        >
                          <Text style={styles.serverModalCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.serverModalSave}
                          disabled={serverUrlSaving}
                          onPress={async () => {
                            setServerUrlSaving(true);
                            try {
                              const trimmed = serverUrlInput.trim().replace(/\/$/, '');
                              setRuntimeBackendUrl(trimmed || null);
                              await saveAppSettings({ customBackendUrl: trimmed });
                              setShowServerModal(false);
                              // Trigger a backend status re-check by briefly resetting state
                              setBackendStatus('checking');
                              setBackendMessage('Reconnecting...');
                            } catch {
                              // best-effort
                            } finally {
                              setServerUrlSaving(false);
                            }
                          }}
                        >
                          {serverUrlSaving
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.serverModalSaveText}>Save & Reconnect</Text>
                          }
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              </View>
            ) : !isWeb && selectedMobileRole ? (
              <View style={styles.mobileLoginContainer}>
                {/* Back to portal selector */}
                <TouchableOpacity
                  style={styles.loginBackNavButton}
                  onPress={handleBackToRoleSelection}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="arrow-back" size={16} color="#166534" />
                  <Text style={styles.loginBackNavText}>Change portal</Text>
                </TouchableOpacity>

                {/* Centered Welcome Header */}
                <View style={styles.loginCenterHeader}>
                  <View style={styles.loginTopIconSquare}>
                    <MaterialIcons name="login" size={22} color="#ffffff" />
                  </View>
                  <Text style={styles.loginHeaderTitle}>Welcome back</Text>
                  <Text style={styles.loginHeaderSubtitle}>
                    Log in to your account
                  </Text>
                </View>

                {/* Login Card Form */}
                <View style={styles.loginBoxCard}>
                  {/* Email / Username field */}
                  <View style={styles.inputFieldGroup}>
                    <Text style={styles.inputFieldLabel}>Email</Text>
                    <View style={styles.inputBoxWithIcon}>
                      <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={styles.inputLeftIcon} />
                      <TextInput
                        style={styles.cleanTextInput}
                        placeholder="you@example.com"
                        placeholderTextColor="#94a3b8"
                        value={identifier}
                        onChangeText={(value) => {
                          setIdentifier(value);
                          if (loginError) setLoginError(null);
                        }}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        editable={!loading}
                      />
                    </View>
                  </View>

                  {/* Password field */}
                  <View style={styles.inputFieldGroup}>
                    <View style={styles.passwordFieldHeaderRow}>
                      <Text style={styles.inputFieldLabel}>Password</Text>
                      <TouchableOpacity
                        onPress={() => {
                          Alert.alert(
                            "Forgot Password",
                            "Please contact your NVC system administrator to recover or reset your account password."
                          );
                        }}
                      >
                        <Text style={styles.forgotPasswordLinkText}>Forgot password?</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.inputBoxWithIcon}>
                      <MaterialIcons name="lock-outline" size={18} color="#94a3b8" style={styles.inputLeftIcon} />
                      <TextInput
                        style={styles.cleanTextInput}
                        placeholder="••••••••"
                        placeholderTextColor="#94a3b8"
                        value={password}
                        onChangeText={(value) => {
                          setPassword(value);
                          if (loginError) setLoginError(null);
                        }}
                        secureTextEntry
                        editable={!loading}
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  {loginError ? (
                    <InlineLoadError
                      title={loginError.title}
                      message={loginError.message}
                    />
                  ) : null}

                  {/* Primary Login button */}
                  <TouchableOpacity
                    style={[
                      styles.loginSubmitButton,
                      loading && styles.buttonDisabled,
                      (!identifier || !password) && styles.loginSubmitButtonInactive,
                    ]}
                    onPress={() => {
                      void handleLogin();
                    }}
                    disabled={loading || !identifier || !password}
                    activeOpacity={0.88}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.loginSubmitButtonText}>Log in</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Bottom link: Don't have an account? Create one */}
                <View style={styles.loginBottomPromptRow}>
                  <Text style={styles.loginBottomPromptText}>Don't have an account? </Text>
                  <TouchableOpacity onPress={openSignupModal} activeOpacity={0.8}>
                    <Text style={styles.loginBottomPromptLink}>Create one</Text>
                  </TouchableOpacity>
                </View>

                {visibleSavedAccounts.length > 0 && (
                  <View style={styles.demoSection}>
                    <Text style={styles.demoTitle}>
                      {`Saved ${selectedMobileRoleLabel} Accounts:`}
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
              </View>
            ) : (
              <>
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

                {visibleSavedAccounts.length > 0 && (
                  <View style={styles.demoSection}>
                    <Text style={styles.demoTitle}>Saved Admin Accounts:</Text>
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

                <TouchableOpacity onPress={openSignupModal}>
                  <Text style={styles.signupText}>Sign up as Admin</Text>
                </TouchableOpacity>
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
              {signupLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 40, width: "100%" }}>
                  <View style={styles.submissionLoadingSpinnerWrap}>
                    <ActivityIndicator size="large" color="#166534" />
                  </View>
                  <Text style={styles.submissionLoadingTitle}>
                    {signupRole === "partner"
                      ? "Submitting Partner Application"
                      : signupRole === "volunteer"
                        ? "Submitting Volunteer Registration"
                        : "Creating Admin Account"}
                  </Text>
                  <Text style={styles.submissionLoadingSubtitle}>
                    {signupRole === "partner"
                      ? "Submitting your organization application to admin for verification and review..."
                      : signupRole === "volunteer"
                        ? "Saving your volunteer membership sheet and profile details..."
                        : "Setting up your administrator credentials..."}
                  </Text>
                </View>
              ) : signupSuccessData ? (
                <View style={{ alignItems: "center", width: "100%", paddingVertical: 10 }}>
                  <View style={styles.submissionSuccessBadgeWrap}>
                    <MaterialIcons name="check" size={32} color="#166534" />
                  </View>
                  <Text style={styles.submissionSuccessHeadline}>
                    Confirmed Registration
                  </Text>
                  <View style={styles.submissionRoleTag}>
                    <Text style={styles.submissionRoleTagText}>
                      {signupSuccessData.role === "partner"
                        ? "Partner Registration"
                        : signupSuccessData.role === "volunteer"
                          ? "Volunteer Registration"
                          : "Admin Account"}
                    </Text>
                  </View>

                  <View style={styles.confirmationSummaryCard}>
                    <View style={styles.confirmationSummaryRow}>
                      <Text style={styles.confirmationSummaryLabel}>Applicant</Text>
                      <Text style={styles.confirmationSummaryValue}>
                        {signupSuccessData.name}
                      </Text>
                    </View>
                    {signupSuccessData.organizationName ? (
                      <View style={styles.confirmationSummaryRow}>
                        <Text style={styles.confirmationSummaryLabel}>Organization</Text>
                        <Text style={styles.confirmationSummaryValue}>
                          {signupSuccessData.organizationName}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.confirmationSummaryRow}>
                      <Text style={styles.confirmationSummaryLabel}>Contact</Text>
                      <Text style={styles.confirmationSummaryValue}>
                        {signupSuccessData.contact}
                      </Text>
                    </View>
                    <View style={styles.confirmationSummaryRow}>
                      <Text style={styles.confirmationSummaryLabel}>Submitted</Text>
                      <Text style={styles.confirmationSummaryValue}>
                        {signupSuccessData.submittedAt}
                      </Text>
                    </View>
                    <View style={[styles.confirmationSummaryRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                      <Text style={styles.confirmationSummaryLabel}>Review Status</Text>
                      <View style={styles.confirmationStatusPill}>
                        <Text style={styles.confirmationStatusPillText}>
                          {signupSuccessData.role === "admin"
                            ? "Active"
                            : "Sent to Volunteer Management"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.submissionConfirmationNote}>
                    {signupSuccessData.role === "volunteer"
                      ? "Confirmed Registration. Your application has been sent to Volunteer Management for approval."
                      : signupSuccessData.message}
                  </Text>

                  <TouchableOpacity
                    style={styles.submissionSuccessButton}
                    onPress={() => {
                      setSignupSuccessData(null);
                      closeSignupModal();
                    }}
                  >
                    <MaterialIcons name="done-all" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.submissionSuccessButtonText}>
                      Got It, Back to Login
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
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
                          : "Submit your organization application. Partner login is unlocked after admin approval."}
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
                    >
                      {signupRole === "admin" ? (
                        <>
                          <TextInput
                            style={styles.input}
                            placeholder="Full Name"
                            placeholderTextColor="#999"
                            value={signupName}
                            onChangeText={(value) => setSignupName(normalizeNameInput(value))}
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Email Address"
                            placeholderTextColor="#999"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            value={signupEmail}
                            onChangeText={setSignupEmail}
                            editable={!signupLoading}
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Password"
                            placeholderTextColor="#999"
                            secureTextEntry
                            value={signupPassword}
                            onChangeText={setSignupPassword}
                            editable={!signupLoading}
                            autoCapitalize="none"
                          />
                        </>
                      ) : signupRole === "partner" ? (
                        <>
                          <Text style={styles.modalSectionLabel}>
                            Organization Information
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Organization Name"
                            placeholderTextColor="#999"
                            value={signupPartnerApplication.organizationName}
                            onChangeText={(value) =>
                              updateSignupPartnerApplication("organizationName", normalizeNameInput(value))
                            }
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <Text style={styles.modalSectionSubLabel}>Sector Type</Text>
                          <View style={styles.pillarGrid}>
                            {(["NGO", "Hospital", "Institution", "Private"] as const).map((sector) => (
                              <TouchableOpacity
                                key={sector}
                                style={[
                                  styles.pillarChip,
                                  signupPartnerApplication.sectorType === sector &&
                                  styles.pillarChipActive,
                                ]}
                                onPress={() =>
                                  updateSignupPartnerApplication("sectorType", sector)
                                }
                                disabled={signupLoading}
                              >
                                <Text
                                  style={[
                                    styles.pillarChipText,
                                    signupPartnerApplication.sectorType === sector &&
                                    styles.pillarChipTextActive,
                                  ]}
                                >
                                  {sector}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          <TextInput
                            style={styles.input}
                            placeholder="SEC Registration No. (Optional)"
                            placeholderTextColor="#999"
                            value={signupPartnerApplication.secRegistrationNo}
                            onChangeText={(value) =>
                              updateSignupPartnerApplication("secRegistrationNo", value)
                            }
                            editable={!signupLoading}
                          />

                          <Text style={styles.modalSectionSubLabel}>
                            Advocacy Focus (Select at least one)
                          </Text>
                          <View style={styles.pillarGrid}>
                            {(["Nutrition", "Education", "Livelihood", "Disaster"] as const).map((focus) => {
                              const isSelected =
                                signupPartnerApplication.advocacyFocus.includes(focus);
                              return (
                                <TouchableOpacity
                                  key={focus}
                                  style={[
                                    styles.pillarChip,
                                    isSelected && styles.pillarChipActive,
                                  ]}
                                  onPress={() => {
                                    const next = isSelected
                                      ? signupPartnerApplication.advocacyFocus.filter(
                                        (f) => f !== focus,
                                      )
                                      : [...signupPartnerApplication.advocacyFocus, focus];
                                    updateSignupPartnerApplication("advocacyFocus", next);
                                  }}
                                  disabled={signupLoading}
                                >
                                  <Text
                                    style={[
                                      styles.pillarChipText,
                                      isSelected && styles.pillarChipTextActive,
                                    ]}
                                  >
                                    {focus}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <Text style={styles.modalSectionLabel}>
                            Account Information
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Contact Person Full Name"
                            placeholderTextColor="#999"
                            value={signupName}
                            onChangeText={(value) => setSignupName(normalizeNameInput(value))}
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Email Address"
                            placeholderTextColor="#999"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            value={signupEmail}
                            onChangeText={updateSignupEmail}
                            editable={!signupLoading}
                          />
                          {renderSignupEmailVerificationControls()}
                          <TextInput
                            style={styles.input}
                            placeholder="Phone Number (e.g. 09171234567)"
                            placeholderTextColor="#999"
                            keyboardType="phone-pad"
                            maxLength={11}
                            value={signupAccountPhone}
                            onChangeText={(value) => setSignupAccountPhone(normalizePhoneInput(value))}
                            editable={!signupLoading}
                          />
                          <TextInput
                            style={[
                              styles.input,
                              signupPasswordValidationMessage && signupPassword.trim()
                                ? styles.inputError
                                : null,
                            ]}
                            placeholder="Password"
                            placeholderTextColor="#999"
                            secureTextEntry
                            value={signupPassword}
                            onChangeText={setSignupPassword}
                            editable={!signupLoading}
                          />
                          {signupPasswordValidationMessage && signupPassword.trim() ? (
                            <Text style={styles.fieldValidationText}>
                              {signupPasswordValidationMessage}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <Text style={styles.modalSectionLabel}>
                            Account Information
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Full Name"
                            placeholderTextColor="#999"
                            value={signupName}
                            onChangeText={(value) => setSignupName(normalizeNameInput(value))}
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Email Address"
                            placeholderTextColor="#999"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            value={signupEmail}
                            onChangeText={updateSignupEmail}
                            editable={!signupLoading}
                          />
                          {renderSignupEmailVerificationControls()}
                          <TextInput
                            style={styles.input}
                            placeholder="Phone Number (e.g. 09171234567)"
                            placeholderTextColor="#999"
                            keyboardType="phone-pad"
                            maxLength={11}
                            value={signupAccountPhone}
                            onChangeText={(value) => setSignupAccountPhone(normalizePhoneInput(value))}
                            editable={!signupLoading}
                          />
                          <TextInput
                            style={[
                              styles.input,
                              signupPasswordValidationMessage && signupPassword.trim()
                                ? styles.inputError
                                : null,
                            ]}
                            placeholder="Password"
                            placeholderTextColor="#999"
                            secureTextEntry
                            value={signupPassword}
                            onChangeText={setSignupPassword}
                            editable={!signupLoading}
                            autoCapitalize="none"
                          />
                          {signupPasswordValidationMessage && signupPassword.trim() ? (
                            <Text style={styles.fieldValidationText}>
                              {signupPasswordValidationMessage}
                            </Text>
                          ) : null}

                          <Text style={styles.modalSectionLabel}>Volunteer Profile</Text>
                           <Text style={styles.modalSectionSubLabel}>Profile Type</Text>
                          <View style={styles.roleSelector}>
                            {["Student", "Adult", "Corporate"].map((type) => (
                              <TouchableOpacity
                                key={type}
                                style={[
                                  styles.roleChip,
                                  signupUserType === type && styles.roleChipActive,
                                ]}
                                onPress={() => setSignupUserType(type as UserType)}
                                disabled={signupLoading}
                              >
                                <Text
                                  style={[
                                    styles.roleChipText,
                                    signupUserType === type &&
                                    styles.roleChipTextActive,
                                  ]}
                                >
                                  {type}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          <Text style={styles.modalSectionLabel}>
                            Membership Information Sheet
                          </Text>
                          <Text style={styles.modalSectionSubLabel}>Gender</Text>
                          <View style={styles.genderGrid}>
                            {["Male", "Female", "Prefer not to say"].map((g) => {
                              const isSelected = signupVolunteerSheet.gender === g;
                              return (
                                <TouchableOpacity
                                  key={g}
                                  style={[
                                    styles.genderChip,
                                    isSelected && styles.genderChipActive,
                                  ]}
                                  onPress={() =>
                                    updateSignupVolunteerSheet("gender", g)
                                  }
                                  disabled={signupLoading}
                                >
                                  <Text
                                    style={[
                                      styles.genderChipText,
                                      isSelected && styles.genderChipTextActive,
                                    ]}
                                  >
                                    {g}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <Text style={styles.modalSectionSubLabel}>
                            Date of Birth
                          </Text>
                          <TouchableOpacity
                            style={styles.datePickerButton}
                            onPress={() => setShowYearPicker(true)}
                            disabled={signupLoading}
                          >
                            <MaterialIcons
                              name="calendar-today"
                              size={20}
                              color="#fff"
                            />
                            <Text style={styles.datePickerButtonText}>
                              {signupVolunteerSheet.dateOfBirth
                                ? format(parseISO(signupVolunteerSheet.dateOfBirth), "MMMM d, yyyy")
                                : "Select Birth Date..."}
                            </Text>
                          </TouchableOpacity>

                          <Text style={styles.modalSectionSubLabel}>
                            Civil Status
                          </Text>
                          <View style={styles.pickerContainer}>
                            <Picker
                              selectedValue={signupVolunteerSheet.civilStatus}
                              enabled={!signupLoading}
                              onValueChange={(itemValue: string) =>
                                updateSignupVolunteerSheet("civilStatus", itemValue)
                              }
                              style={styles.picker}
                            >
                              <Picker.Item label="Select Civil Status..." value="" />
                              {["Single", "Married", "Widowed", "Separated"].map((status) => (
                                <Picker.Item key={status} label={status} value={status} />
                              ))}
                            </Picker>
                          </View>

                          <Text style={styles.modalSectionLabel}>Home Address</Text>
                          <View style={styles.locationField}>
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
                          </View>

                          <Text style={styles.modalSectionSubLabel}>
                            Street Address / House Number
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="House No., Street Name, Subdivision..."
                            placeholderTextColor="#999"
                            value={signupVolunteerSheet.homeAddress}
                            onChangeText={(value) =>
                              updateSignupVolunteerSheet("homeAddress", normalizeProfessionalInput(value))
                            }
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />

                          <Text style={styles.modalSectionLabel}>
                            Professional Information
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Occupation"
                            placeholderTextColor="#999"
                            value={signupVolunteerSheet.occupation}
                            onChangeText={(value) =>
                              updateSignupVolunteerSheet("occupation", normalizeProfessionalInput(value))
                            }
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="Workplace or School"
                            placeholderTextColor="#999"
                            value={signupVolunteerSheet.workplaceOrSchool}
                            onChangeText={(value) =>
                              updateSignupVolunteerSheet("workplaceOrSchool", normalizeProfessionalInput(value))
                            }
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />
                          <TextInput
                            style={styles.input}
                            placeholder="College Course"
                            placeholderTextColor="#999"
                            value={signupVolunteerSheet.collegeCourse}
                            onChangeText={(value) =>
                              updateSignupVolunteerSheet("collegeCourse", normalizeProfessionalInput(value))
                            }
                            editable={!signupLoading}
                            autoCapitalize="words"
                          />

                          <Text style={styles.modalSectionLabel}>
                            Background & Skills
                          </Text>
                          <View style={styles.customSkillRow}>
                            <TextInput
                              style={styles.customSkillInput}
                              placeholder="Enter custom skill..."
                              placeholderTextColor="#999"
                              value={customVolunteerSkill}
                              onChangeText={setCustomVolunteerSkill}
                              onSubmitEditing={handleAddCustomVolunteerSkill}
                              editable={!signupLoading}
                            />
                            <TouchableOpacity
                              style={styles.customSkillAddButton}
                              onPress={handleAddCustomVolunteerSkill}
                              disabled={signupLoading}
                            >
                              <MaterialIcons name="add" size={18} color="#fff" />
                              <Text style={styles.customSkillAddButtonText}>Add</Text>
                            </TouchableOpacity>
                          </View>

                          <Text style={styles.modalSectionSubLabel}>
                            Select Skills (Select all that apply)
                          </Text>
                          <View style={styles.dropdownWrap}>
                            <TouchableOpacity
                              style={[
                                styles.dropdownTrigger,
                                signupLoading && styles.dropdownTriggerDisabled,
                              ]}
                              onPress={() => !signupLoading && setShowSkillsDropdown((v) => !v)}
                              disabled={signupLoading}
                              activeOpacity={0.75}
                            >
                              <Text
                                style={[
                                  styles.dropdownTriggerText,
                                  signupVolunteerSheet.skills.length === 0 && styles.dropdownPlaceholder,
                                ]}
                                numberOfLines={1}
                              >
                                {signupVolunteerSheet.skills.length === 0
                                  ? "Tap to select skills..."
                                  : `${signupVolunteerSheet.skills.length} skill${signupVolunteerSheet.skills.length > 1 ? "s" : ""} selected`}
                              </Text>
                              <MaterialIcons
                                name={showSkillsDropdown ? "keyboard-arrow-up" : "keyboard-arrow-down"}
                                size={20}
                                color="#64748b"
                              />
                            </TouchableOpacity>
                            {showSkillsDropdown ? (
                              <ScrollView
                                style={styles.dropdownMenu}
                                nestedScrollEnabled
                                keyboardShouldPersistTaps="handled"
                              >
                                {availableSkills.map((skill) => {
                                  const isSelected = signupVolunteerSheet.skills.includes(skill);
                                  return (
                                    <TouchableOpacity
                                      key={skill}
                                      style={[
                                        styles.dropdownOption,
                                        isSelected && styles.dropdownOptionSelected,
                                      ]}
                                      onPress={() => handleToggleVolunteerSkill(skill)}
                                    >
                                      <MaterialIcons
                                        name={isSelected ? "check-box" : "check-box-outline-blank"}
                                        size={20}
                                        color={isSelected ? "#166534" : "#94a3b8"}
                                      />
                                      <Text
                                        style={[
                                          styles.dropdownOptionText,
                                          isSelected && styles.dropdownOptionTextSelected,
                                        ]}
                                      >
                                        {skill}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            ) : null}
                          </View>

                          {signupVolunteerSheet.skills.length > 0 ? (
                            <View style={styles.selectedSkillsTagsRow}>
                              {signupVolunteerSheet.skills.map((skill) => (
                                <View key={skill} style={styles.selectedSkillTag}>
                                  <Text style={styles.selectedSkillTagText}>{skill}</Text>
                                  <TouchableOpacity
                                    style={styles.selectedSkillTagRemove}
                                    onPress={() => handleToggleVolunteerSkill(skill)}
                                    disabled={signupLoading}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  >
                                    <MaterialIcons name="close" size={14} color="#166534" />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          ) : null}

                          <Text style={styles.modalSectionLabel}>
                            Credentials & Certificates (Optional)
                          </Text>
                          {signupVolunteerSheet.certificationsOrTrainings ? (
                            <View style={styles.certificatePreviewCard}>
                              <Image
                                source={{
                                  uri: signupVolunteerSheet.certificationsOrTrainings,
                                }}
                                style={styles.certificatePreviewImage}
                                resizeMode="cover"
                              />
                              <View style={styles.certificatePreviewFooter}>
                                <Text
                                  style={styles.certificatePreviewLabel}
                                  numberOfLines={1}
                                >
                                  Uploaded Certificate
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
                          ) : (
                            <View style={styles.uploadActionsRow}>
                              <TouchableOpacity
                                style={styles.uploadButton}
                                onPress={handlePickVolunteerCertificate}
                                disabled={signupLoading}
                              >
                                <Text style={styles.uploadButtonText}>
                                  Upload Certificate Image
                                </Text>
                              </TouchableOpacity>
                            </View>
                          )}
                          <Text style={styles.certificateHelperText}>
                            Upload any professional training certificate or credentials
                            related to disasters, feeding programs or child
                            care.
                          </Text>

                          <Text style={styles.modalSectionLabel}>
                            Valid ID (Required)
                          </Text>
                          {signupVolunteerSheet.validIdPhoto ? (
                            <View style={styles.certificatePreviewCard}>
                              <Image
                                source={{
                                  uri: signupVolunteerSheet.validIdPhoto,
                                }}
                                style={styles.certificatePreviewImage}
                                resizeMode="cover"
                              />
                              <View style={styles.certificatePreviewFooter}>
                                <Text
                                  style={styles.certificatePreviewLabel}
                                  numberOfLines={1}
                                >
                                  Uploaded ID
                                </Text>
                                <TouchableOpacity
                                  onPress={() =>
                                    updateSignupVolunteerSheet(
                                      "validIdPhoto",
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
                          ) : (
                            <View style={styles.uploadActionsRow}>
                              <TouchableOpacity
                                style={styles.uploadButton}
                                onPress={handlePickValidIdPhoto}
                                disabled={signupLoading}
                              >
                                <Text style={styles.uploadButtonText}>
                                  Upload Valid ID Image
                                </Text>
                              </TouchableOpacity>
                            </View>
                          )}
                          <Text style={styles.certificateHelperText}>
                            Please upload a clear image of any government-issued Valid ID.
                          </Text>

                          <Text style={styles.modalSectionLabel}>Orientation Video</Text>
                          <View style={styles.briefingVideoCard}>
                            <View style={styles.briefingVideoPreview}>
                              <MaterialIcons
                                name="play-circle-outline"
                                size={56}
                                color="#fff"
                              />
                              <Text style={styles.briefingVideoPreviewText}>
                                Watch NVC Introduction Video
                              </Text>
                            </View>
                            <Text style={styles.briefingVideoTitle}>
                              About NVC Foundation, Inc.
                            </Text>
                            <Text style={styles.briefingVideoDescription}>
                              Watch the brief video to understand our mission, values,
                              and guidelines for all registered volunteers.
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
                                updateSignupVolunteerSheet("affiliationOrg1", normalizeProfessionalInput(value))
                              }
                              editable={!signupLoading}
                              autoCapitalize="words"
                            />
                            <TextInput
                              style={[styles.input, styles.affiliationInput]}
                              placeholder="Position"
                              placeholderTextColor="#999"
                              value={signupVolunteerSheet.affiliationPos1}
                              onChangeText={(value) =>
                                updateSignupVolunteerSheet("affiliationPos1", normalizeProfessionalInput(value))
                              }
                              editable={!signupLoading}
                              autoCapitalize="words"
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
                    <>
                      {signupValidationError && (
                        <View style={styles.validationErrorBanner}>
                          <MaterialIcons name="error-outline" size={16} color="#b91c1c" />
                          <Text style={styles.validationErrorBannerText}>
                            {signupValidationError}
                          </Text>
                        </View>
                      )}

                      <View style={styles.modalActions}>
                        <TouchableOpacity
                          style={styles.modalSecondaryButton}
                          onPress={() => {
                            setSignupValidationError(null);
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
                            signupLoading && styles.buttonDisabled,
                          ]}
                          onPress={handleSignup}
                          disabled={signupLoading}
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
                    </>
                  )}
                </>
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
                          setShowMonthPicker(true);
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

          {/* Month Picker Modal */}
          {showMonthPicker && (
            <Modal
              visible={showMonthPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowMonthPicker(false)}
            >
              <View style={styles.yearPickerOverlay}>
                <View style={styles.yearPickerModal}>
                  <View style={styles.yearPickerHeader}>
                    <Text style={styles.yearPickerTitle}>
                      Select Birth Month
                    </Text>
                    <TouchableOpacity onPress={() => setShowMonthPicker(false)}>
                      <MaterialIcons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.yearPickerList}>
                    {[
                      "January",
                      "February",
                      "March",
                      "April",
                      "May",
                      "June",
                      "July",
                      "August",
                      "September",
                      "October",
                      "November",
                      "December",
                    ].map((monthName, index) => (
                      <TouchableOpacity
                        key={monthName}
                        style={[
                          styles.yearPickerItem,
                          selectedDate.getMonth() === index &&
                            styles.yearPickerItemSelected,
                        ]}
                        onPress={() => {
                          const nextDate = new Date(selectedDate);
                          nextDate.setMonth(index);
                          setSelectedDate(nextDate);
                          setShowMonthPicker(false);
                          setShowDayPicker(true);
                        }}
                      >
                        <Text
                          style={[
                            styles.yearPickerItemText,
                            selectedDate.getMonth() === index &&
                              styles.yearPickerItemTextSelected,
                          ]}
                        >
                          {monthName}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TouchableOpacity
                    style={styles.yearPickerCancel}
                    onPress={() => setShowMonthPicker(false)}
                  >
                    <Text style={styles.yearPickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}

          {/* Day Picker Modal */}
          {showDayPicker && (
            <Modal
              visible={showDayPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowDayPicker(false)}
            >
              <View style={styles.yearPickerOverlay}>
                <View style={styles.yearPickerModal}>
                  <View style={styles.yearPickerHeader}>
                    <Text style={styles.yearPickerTitle}>Select Birth Day</Text>
                    <TouchableOpacity onPress={() => setShowDayPicker(false)}>
                      <MaterialIcons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.yearPickerList}>
                    {Array.from(
                      { length: new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate() },
                      (_, i) => i + 1,
                    ).map((day) => (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.yearPickerItem,
                          selectedDay === day && styles.yearPickerItemSelected,
                        ]}
                        onPress={() => {
                          const nextDate = new Date(selectedDate);
                          nextDate.setDate(day);
                          setSelectedDate(nextDate);
                          setShowDayPicker(false);
                          const year = nextDate.getFullYear();
                          const month = String(nextDate.getMonth() + 1).padStart(2, "0");
                          const dayText = String(nextDate.getDate()).padStart(2, "0");
                          updateSignupVolunteerSheet("dateOfBirth", `${year}-${month}-${dayText}`);
                        }}
                      >
                        <Text
                          style={[
                            styles.yearPickerItemText,
                            selectedDay === day && styles.yearPickerItemTextSelected,
                          ]}
                        >
                          {day}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TouchableOpacity
                    style={styles.yearPickerCancel}
                    onPress={() => setShowDayPicker(false)}
                  >
                    <Text style={styles.yearPickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
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
  webHeroHeadingOriginal: {
    color: "#ffffff",
    fontSize: 42,
    fontWeight: "900",
    lineHeight: 52,
    marginBottom: 16,
    maxWidth: 620,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
    fontFamily: "'DM Sans', sans-serif",
    letterSpacing: -0.5,
  },
  webHeroSubHeadingOriginal: {
    color: "#ecfdf5",
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 32,
    maxWidth: 580,
    textShadowColor: "rgba(0, 0, 0, 0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    fontFamily: "'DM Sans', sans-serif",
    letterSpacing: 0.2,
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
    fontFamily: "'Nunito', sans-serif",
  },
  webAccessNoticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
    fontFamily: "'Nunito', sans-serif",
  },
  mobilePortalContainer: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 20,
  },
  mobileTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    width: "100%",
  },
  mobileTopBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mobileBrandLogoBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileBrandLogoLetter: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    fontFamily: "'Nunito', sans-serif",
  },
  mobileBrandTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    fontFamily: "'Nunito', sans-serif",
  },
  mobileTopHelpRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  mobileTopHelpText: {
    fontSize: 12,
    color: "#64748b",
    fontFamily: "'Nunito', sans-serif",
  },
  portalHeroHeader: {
    alignItems: "center",
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  portalEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#166534",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 8,
    fontFamily: "'Nunito', sans-serif",
  },
  portalHeadline: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 8,
    fontFamily: "'Nunito', sans-serif",
    letterSpacing: -0.5,
  },
  portalSubtext: {
    fontSize: 14,
    lineHeight: 22,
    color: "#64748b",
    textAlign: "center",
    maxWidth: 520,
    fontFamily: "'Nunito', sans-serif",
  },
  portalGridContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    marginBottom: 24,
  },
  portalGridContainerStacked: {
    flexDirection: "column",
  },
  portalTileCard: {
    flex: 1,
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  volunteerBadgeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#ffe4e6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  partnerBadgeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  portalTileTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
    fontFamily: "'Nunito', sans-serif",
  },
  portalTileDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: "#64748b",
    marginBottom: 20,
    minHeight: 40,
    fontFamily: "'Nunito', sans-serif",
  },
  portalTileButton: {
    backgroundColor: "#166534",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  portalTileButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "'Nunito', sans-serif",
  },
  portalSignupFooter: {
    alignSelf: "center",
    paddingVertical: 10,
    marginBottom: 16,
  },
  portalSignupFooterText: {
    color: "#166534",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "'Nunito', sans-serif",
    textAlign: "center",
  },
  mobileLoginContainer: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 24,
  },
  loginBackNavButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#dcfce7",
    marginBottom: 20,
  },
  loginBackNavText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
    fontFamily: "'Nunito', sans-serif",
  },
  loginCenterHeader: {
    alignItems: "center",
    marginBottom: 22,
  },
  loginTopIconSquare: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#166534",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#166534",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  loginHeaderTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#166534",
    marginBottom: 4,
    fontFamily: "'Nunito', sans-serif",
  },
  loginHeaderSubtitle: {
    fontSize: 14,
    color: "#64748b",
    fontFamily: "'Nunito', sans-serif",
  },
  loginBoxCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
    marginBottom: 16,
  },
  inputFieldGroup: {
    marginBottom: 16,
  },
  inputFieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
    marginBottom: 6,
    fontFamily: "'Nunito', sans-serif",
  },
  passwordFieldHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  forgotPasswordLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#166534",
    fontFamily: "'Nunito', sans-serif",
  },
  inputBoxWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    height: 48,
  },
  inputLeftIcon: {
    marginRight: 8,
  },
  cleanTextInput: {
    flex: 1,
    height: "100%",
    fontSize: 14,
    color: "#0f172a",
    fontFamily: "'Nunito', sans-serif",
  },
  loginSubmitButton: {
    backgroundColor: "#166534",
    borderRadius: 10,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  loginSubmitButtonInactive: {
    backgroundColor: "#a7f3d0",
    opacity: 0.85,
  },
  loginSubmitButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "'Nunito', sans-serif",
  },
  loginBottomPromptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  loginBottomPromptText: {
    fontSize: 13,
    color: "#64748b",
    fontFamily: "'Nunito', sans-serif",
  },
  loginBottomPromptLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
    fontFamily: "'Nunito', sans-serif",
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
    fontFamily: "'Nunito', sans-serif",
  },
  selectionSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: "#475569",
    textAlign: "center",
    fontFamily: "'Nunito', sans-serif",
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
  inputError: {
    borderColor: "#dc2626",
    backgroundColor: "#fef2f2",
  },
  fieldValidationText: {
    marginTop: -8,
    marginBottom: 15,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: "#b91c1c",
  },
  emailVerificationCard: {
    borderWidth: 1,
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    padding: 12,
    marginTop: -4,
    marginBottom: 15,
  },
  emailVerificationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  emailVerificationTitle: {
    flex: 1,
    fontSize: 13,
    color: "#14532d",
    fontWeight: "800",
  },
  emailVerificationText: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 17,
    marginBottom: 10,
  },
  emailVerificationActions: {
    flexDirection: "row",
    gap: 8,
    alignItems: "stretch",
  },
  otpInput: {
    flex: 1,
    marginBottom: 0,
    minHeight: 46,
    paddingVertical: 11,
    textAlign: "center",
    fontWeight: "800",
  },
  otpActionButton: {
    width: 92,
    borderRadius: 10,
    backgroundColor: "#166534",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  otpActionButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 13,
  },
  otpSendButton: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#86efac",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  otpSendButtonDisabled: {
    opacity: 0.55,
  },
  otpSendButtonText: {
    color: "#166534",
    fontWeight: "800",
    fontSize: 13,
  },
  compactInput: {
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#166534",
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
  submissionModalOverlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    zIndex: 99999,
  },
  submissionLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    borderRadius: 16,
    zIndex: 99999,
  },
  submissionLoadingCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    maxWidth: 440,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  submissionLoadingSpinnerWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  submissionLoadingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 8,
  },
  submissionLoadingSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
    textAlign: "center",
    marginBottom: 8,
  },
  submissionSuccessBadgeWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#dcfce7",
    borderWidth: 3,
    borderColor: "#86efac",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  submissionSuccessHeadline: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    letterSpacing: -0.5,
    textAlign: "center",
    marginBottom: 6,
  },
  submissionRoleTag: {
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 14,
  },
  submissionRoleTagText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#166534",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  confirmationSummaryCard: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
  },
  confirmationSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    gap: 8,
  },
  confirmationSummaryLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  confirmationSummaryValue: {
    flex: 1,
    fontSize: 13,
    color: "#0f172a",
    fontWeight: "700",
    textAlign: "right",
  },
  confirmationStatusPill: {
    backgroundColor: "#fef3c7",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  confirmationStatusPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400e",
  },
  submissionConfirmationNote: {
    fontSize: 12,
    lineHeight: 18,
    color: "#475569",
    textAlign: "center",
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  submissionSuccessButton: {
    backgroundColor: "#166534",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    shadowColor: "#166534",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  submissionSuccessButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  validationErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
    gap: 8,
  },
  validationErrorBannerText: {
    flex: 1,
    fontSize: 12,
    color: "#b91c1c",
    fontWeight: "600",
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
  selectedSkillsTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  selectedSkillTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#dcfce7",
    borderWidth: 1,
    borderColor: "#86efac",
    borderRadius: 16,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 6,
    gap: 4,
  },
  selectedSkillTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#166534",
  },
  selectedSkillTagRemove: {
    padding: 2,
    borderRadius: 10,
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
  serverSettingsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 12,
    marginTop: 4,
    opacity: 0.7,
  },
  serverSettingsButtonText: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
  },
  serverModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  serverModalCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  serverModalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
  },
  serverModalDesc: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
    marginBottom: 12,
  },
  serverModalInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 14,
  },
  serverModalButtons: {
    flexDirection: "row",
    gap: 10,
  },
  serverModalCancel: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
  },
  serverModalCancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
  },
  serverModalSave: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#166534",
    alignItems: "center",
    justifyContent: "center",
  },
  serverModalSaveText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  otpTimerText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#059669",
    marginTop: 6,
    marginBottom: 2,
    textAlign: "center",
  },
  otpExpiredContainer: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  otpExpiredText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#dc2626",
    textAlign: "center",
  },
});
