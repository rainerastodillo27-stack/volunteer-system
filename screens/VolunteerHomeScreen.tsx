import React from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { VolunteerTabParamList } from '../navigation/VolunteerNavigator';

type VolunteerNavProp = BottomTabNavigationProp<VolunteerTabParamList>;

export default function VolunteerHomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<VolunteerNavProp>();
  const insets = useSafeAreaInsets();

  const handleSeeMission = () => {
    navigation.navigate('Events');
  };

  const handleDonate = () => {
    if (Platform.OS === 'web') {
      window.open('https://nvcfoundation-ph.org/donate', '_blank');
    } else {
      Linking.openURL('https://nvcfoundation-ph.org/donate').catch(() => {
        Alert.alert('Error', 'Unable to open donation page');
      });
    }
  };

  const handleShop = () => {
    if (Platform.OS === 'web') {
      window.open('https://nvcfoundation-ph.org/artisans-of-hope', '_blank');
    } else {
      Linking.openURL('https://nvcfoundation-ph.org/artisans-of-hope').catch(() => {
        Alert.alert('Error', 'Unable to open store page');
      });
    }
  };

  const handleNotificationPress = () => {
    navigation.navigate('Messages');
  };

  return (
    <View style={[styles.rootContainer, { paddingTop: Math.max(insets.top, 12) }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header App Bar */}
        <View style={styles.appbar}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 3C9 7 6 9 6 13a6 6 0 0 0 12 0c0-4-3-6-6-10Z"
                  fill="#E8A33D"
                />
              </Svg>
            </View>
            <Text style={styles.brandName}>NVC Foundation</Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleNotificationPress}
            activeOpacity={0.7}
          >
            <MaterialIcons name="notifications-none" size={20} color="#22201B" />
          </TouchableOpacity>
        </View>

        {/* HERO */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>A Nation Free From Hunger</Text>
          <Text style={styles.heroTitle}>
            Nutrition, education, and livelihood, built by people who show up.
          </Text>
          <Text style={styles.heroSub}>
            Founded in Bacolod City in 2010, NVC Foundation turns everyday
            volunteers into lasting change.
          </Text>
          <TouchableOpacity
            style={styles.heroCta}
            onPress={handleSeeMission}
            activeOpacity={0.9}
          >
            <Text style={styles.heroCtaText}>See our mission</Text>
            <MaterialIcons name="chevron-right" size={16} color="#22201B" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>

        {/* MISSION PILLARS */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Our mission</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillarsContainer}
          >
            {/* Nutrition */}
            <View style={styles.pillar}>
              <View style={[styles.pillarIcon, styles.pillarN]}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M12 2C9 6 5 9 5 14a7 7 0 0 0 14 0c0-5-4-8-7-12Z"
                    stroke="#C97F1F"
                    strokeWidth={2}
                  />
                </Svg>
              </View>
              <Text style={styles.pillarTitle}>Nutrition</Text>
              <Text style={styles.pillarDesc}>
                Nutritious food and scalable protocols for children of the poor.
              </Text>
            </View>

            {/* Education */}
            <View style={styles.pillar}>
              <View style={[styles.pillarIcon, styles.pillarE]}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M4 6l8-3 8 3-8 3-8-3Z"
                    stroke="#1F3A2E"
                    strokeWidth={2}
                  />
                  <Path
                    d="M4 6v7l8 3 8-3V6"
                    stroke="#1F3A2E"
                    strokeWidth={2}
                  />
                </Svg>
              </View>
              <Text style={styles.pillarTitle}>Education</Text>
              <Text style={styles.pillarDesc}>
                Formal and non-formal learning for children and their families.
              </Text>
            </View>

            {/* Livelihood */}
            <View style={styles.pillar}>
              <View style={[styles.pillarIcon, styles.pillarL]}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Rect
                    x="4"
                    y="10"
                    width="16"
                    height="9"
                    rx="1.5"
                    stroke="#B0432B"
                    strokeWidth={2}
                  />
                  <Path
                    d="M8 10V7a4 4 0 0 1 8 0v3"
                    stroke="#B0432B"
                    strokeWidth={2}
                  />
                </Svg>
              </View>
              <Text style={styles.pillarTitle}>Livelihood</Text>
              <Text style={styles.pillarDesc}>
                Sustainable income opportunities for whole communities.
              </Text>
            </View>
          </ScrollView>
        </View>

        {/* IMPACT STAT */}
        <View style={styles.impactCard}>
          <View style={styles.ringWrap}>
            <Svg width={76} height={76} viewBox="0 0 76 76">
              <Circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#E3D8BC"
                strokeWidth={8}
              />
              <Circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke="#E8A33D"
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={201}
                strokeDashoffset={26}
                transform="rotate(-90 38 38)"
              />
            </Svg>
            <View style={styles.ringLabel}>
              <Text style={styles.ringLabelText}>87%</Text>
            </View>
          </View>
          <View style={styles.impactCopy}>
            <Text style={styles.impactNum}>Mingo Meals success rate</Text>
            <Text style={styles.impactDesc}>
              1,283 children in Iloilo enrolled in the nutrition protocol over
              the past two years.
            </Text>
          </View>
        </View>

        {/* STORY */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>From the president</Text>
          </View>
          <View style={styles.storyCard}>
            <View style={styles.storyImg}>
              <Text style={styles.quoteMark}>“”</Text>
            </View>
            <View style={styles.storyBody}>
              <Text style={styles.storyQuote}>
                2022 pushed us to design a holistic nutrition program, and
                Sunlife Foundation gave us the fuel to pilot it. We share the
                87% success rate with them.
              </Text>
              <Text style={styles.storyAttr}>MILLIE L. KILAYKO, PRESIDENT</Text>
            </View>
          </View>
        </View>

        {/* AWARDS */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recognition</Text>
            <TouchableOpacity onPress={() => Alert.alert('Awards', 'NVC Foundation is fully certified by DSWD, SEC, and PCNC.')}>
              <Text style={styles.sectionLink}>See all</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.awardsContainer}
          >
            <View style={styles.awardCard}>
              <Text style={styles.awardDate}>Dec 10, 2024</Text>
              <Text style={styles.awardTitle}>
                Recognized by the Iloilo Provincial Health Office
              </Text>
            </View>
            <View style={styles.awardCard}>
              <Text style={styles.awardDate}>Dec 3, 2024</Text>
              <Text style={styles.awardTitle}>
                Outstanding Auxiliary SWD Agency Award, DSWD
              </Text>
            </View>
            <View style={styles.awardCard}>
              <Text style={styles.awardDate}>Nov 15, 2023</Text>
              <Text style={styles.awardDate}>Healthy Pilipinas Award, Department of Health</Text>
            </View>
          </ScrollView>
        </View>

        <View style={styles.divider} />

        {/* GIVE */}
        <View style={styles.giveCard}>
          <Text style={styles.giveTitle}>Volunteer now</Text>
          <Text style={styles.giveDesc}>
            Volunteer now will go to events.
          </Text>
          <View style={styles.giveActions}>
            <TouchableOpacity
              style={[styles.btnSolid, { marginRight: 0 }]}
              onPress={handleSeeMission}
              activeOpacity={0.85}
            >
              <Text style={styles.btnSolidText}>Volunteer now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#FAF5E9',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  appbar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#1F3A2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  brandName: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    fontSize: 16,
    color: '#22201B',
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderColor: '#DED2B4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    marginHorizontal: 20,
    marginBottom: 22,
    backgroundColor: '#1F3A2E',
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 20,
    position: 'relative',
    overflow: 'hidden',
  },
  heroEyebrow: {
    color: '#E8A33D',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 24,
    lineHeight: 28,
    color: '#ffffff',
    marginVertical: 10,
  },
  heroSub: {
    color: '#D8E0DA',
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 18,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E8A33D',
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 100,
  },
  heroCtaText: {
    color: '#22201B',
    fontWeight: '700',
    fontSize: 13.5,
  },
  section: {
    marginHorizontal: 20,
    marginTop: 26,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 19,
    color: '#22201B',
  },
  sectionLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B0432B',
  },
  pillarsContainer: {
    paddingRight: 20,
  },
  pillar: {
    width: 138,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 16,
    padding: 14,
    marginRight: 12,
  },
  pillarIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  pillarN: {
    backgroundColor: '#FCEEDA',
  },
  pillarE: {
    backgroundColor: '#E4EEE7',
  },
  pillarL: {
    backgroundColor: '#F6E3DD',
  },
  pillarTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#22201B',
    marginBottom: 4,
  },
  pillarDesc: {
    fontSize: 11,
    lineHeight: 14,
    color: '#5B564C',
  },
  impactCard: {
    marginHorizontal: 20,
    marginTop: 26,
    backgroundColor: '#F2E9D8',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ringWrap: {
    position: 'relative',
    width: 76,
    height: 76,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringLabel: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringLabelText: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '700',
    fontSize: 16,
    color: '#1F3A2E',
  },
  impactCopy: {
    flex: 1,
    marginLeft: 16,
  },
  impactNum: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 15,
    color: '#22201B',
    marginBottom: 2,
  },
  impactDesc: {
    fontSize: 12,
    color: '#5B564C',
    lineHeight: 16,
  },
  storyCard: {
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 20,
    overflow: 'hidden',
  },
  storyImg: {
    height: 120,
    backgroundColor: '#6B8F71',
    position: 'relative',
  },
  quoteMark: {
    position: 'absolute',
    left: 10,
    top: -14,
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontSize: 70,
    color: 'rgba(255, 255, 255, 0.18)',
    fontWeight: '700',
  },
  storyBody: {
    backgroundColor: '#ffffff',
    padding: 16,
  },
  storyQuote: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontStyle: 'italic',
    fontSize: 13.5,
    lineHeight: 20,
    color: '#22201B',
    marginBottom: 10,
  },
  storyAttr: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#B0432B',
    letterSpacing: 0.3,
  },
  awardsContainer: {
    paddingRight: 20,
  },
  awardCard: {
    width: 210,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#DED2B4',
    borderRadius: 16,
    padding: 14,
    marginRight: 12,
  },
  awardDate: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#C97F1F',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  awardTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#22201B',
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#DED2B4',
    marginHorizontal: 20,
    marginTop: 26,
  },
  giveCard: {
    marginHorizontal: 20,
    marginTop: 26,
    backgroundColor: '#B0432B',
    borderRadius: 20,
    padding: 20,
  },
  giveTitle: {
    fontFamily: Platform.OS === 'web' ? "'Nunito', sans-serif" : 'Nunito',
    fontWeight: '600',
    fontSize: 18,
    color: '#ffffff',
    marginBottom: 6,
  },
  giveDesc: {
    fontSize: 12.5,
    color: '#F6DAD0',
    lineHeight: 18,
    marginBottom: 16,
  },
  giveActions: {
    flexDirection: 'row',
  },
  btnSolid: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingVertical: 11,
    borderRadius: 100,
    alignItems: 'center',
    marginRight: 10,
  },
  btnSolidText: {
    color: '#B0432B',
    fontWeight: '700',
    fontSize: 13,
  },
  btnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    paddingVertical: 11,
    borderRadius: 100,
    alignItems: 'center',
  },
  btnOutlineText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});
