import { ImageSourcePropType } from 'react-native';
import { Project } from '../models/types';
import { getProjectStatusColor } from './projectStatus';
import { isImageMediaUri } from './media';
import artisansOfHopeImage from '../assets/programs/artisans-of-hope.jpg';
import educationImage from '../assets/programs/education.jpg';
import farmToForkImage from '../assets/programs/farm-to-fork.jpg';
import growingHopeImage from '../assets/programs/growing-hope.jpg';
import livelihoodImage from '../assets/programs/livelihood.jpg';
import lovebagsImage from '../assets/programs/lovebags.jpg';
import mingoReliefImage from '../assets/programs/mingo-relief.jpg';
import nutritionImage from '../assets/programs/nutrition.jpg';
import peterProjectImage from '../assets/programs/peter-project.jpg';
import projectJosephImage from '../assets/programs/project-joseph.jpg';
import schoolSupportImage from '../assets/programs/school-support.jpg';

const PROGRAM_IMAGE_BY_CATEGORY: Partial<Record<Project['category'], ImageSourcePropType>> = {
  Nutrition: nutritionImage,
  Education: educationImage,
  Livelihood: livelihoodImage,
};

const PROGRAM_PHOTO_BY_TITLE: Record<string, ImageSourcePropType> = {
  'Farm to Fork Program': farmToForkImage,
  'Mingo for Nutritional Support': nutritionImage,
  'Mingo for Emergency Relief': mingoReliefImage,
  LoveBags: lovebagsImage,
  'School Support': schoolSupportImage,
  'Artisans of Hope': artisansOfHopeImage,
  'Project Joseph': projectJosephImage,
  'Growing Hope': growingHopeImage,
  'Peter Project': peterProjectImage,
};

const PROGRAM_PHOTO_MATCHERS: Array<{
  matches: (project: Project, normalizedTitle: string) => boolean;
  source: ImageSourcePropType;
}> = [
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('farm to fork'),
    source: farmToForkImage,
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('lovebag') || normalizedTitle.includes('school bag'),
    source: lovebagsImage,
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('school'),
    source: schoolSupportImage,
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('artisans'),
    source: artisansOfHopeImage,
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('joseph') || normalizedTitle.includes('sewing'),
    source: projectJosephImage,
  },
  {
    matches: (_project, normalizedTitle) =>
      normalizedTitle.includes('growing hope') || normalizedTitle.includes('garden'),
    source: growingHopeImage,
  },
  {
    matches: (_project, normalizedTitle) => normalizedTitle.includes('peter'),
    source: peterProjectImage,
  },
  {
    matches: (project, normalizedTitle) =>
      normalizedTitle.includes('mingo') || normalizedTitle.includes('masiglang') || project.category === 'Nutrition',
    source: nutritionImage,
  },
];

function getProgramPhotoSource(project: Project): ImageSourcePropType | undefined {
  if (!project || !project.title) {
    return undefined;
  }

  if (PROGRAM_PHOTO_BY_TITLE[project.title]) {
    return PROGRAM_PHOTO_BY_TITLE[project.title];
  }

  const normalizedTitle = project.title.trim().toLowerCase();
  return PROGRAM_PHOTO_MATCHERS.find((entry) => entry.matches(project, normalizedTitle))?.source;
}

function getProjectImageSources(project: Project): ImageSourcePropType[] {
  if (!project) {
    return [];
  }

  if (project.imageHidden) {
    return [];
  }

  const imageSources: ImageSourcePropType[] = [];
  const hasUploadedProjectImage = isImageMediaUri(project.imageUrl);
  if (hasUploadedProjectImage) {
    imageSources.push({ uri: project.imageUrl! });
  }
  const isProposalCreatedProject = String(project.id || '').startsWith('project-proposal-');
  if (isProposalCreatedProject && !hasUploadedProjectImage) {
    return imageSources;
  }
  const programPhotoSource = getProgramPhotoSource(project);

  if (programPhotoSource) {
    imageSources.push(programPhotoSource);
  }

  if (project.programModule && project.programModule in PROGRAM_IMAGE_BY_CATEGORY) {
    imageSources.push(
      PROGRAM_IMAGE_BY_CATEGORY[project.programModule as Project['category']] as ImageSourcePropType
    );
  }

  const categoryImageSource = project.category ? PROGRAM_IMAGE_BY_CATEGORY[project.category] : undefined;
  if (categoryImageSource && !imageSources.includes(categoryImageSource)) {
    imageSources.push(categoryImageSource);
  }

  return imageSources;
}

export function getPrimaryProjectImageSource(project: Project): ImageSourcePropType | undefined {
  return getProjectImageSources(project)[0];
}

type ProjectCoordinates = Pick<Project['location'], 'latitude' | 'longitude'>;

const KNOWN_PLACE_COORDINATES: Array<{
  keywords: string[];
  latitude: number;
  longitude: number;
}> = [
  {
    keywords: ['baybay talisay city', 'baybay talisay', 'talisay city', 'city of talisay', 'talisay'],
    latitude: 10.7373,
    longitude: 122.9673,
  },
  {
    keywords: ['kabankalan city', 'kabankalan'],
    latitude: 9.9867,
    longitude: 122.8073,
  },
  {
    keywords: ['bacolod city', 'bacolod'],
    latitude: 10.6765,
    longitude: 122.9509,
  },
  {
    keywords: ['bago city', 'bago'],
    latitude: 10.5333,
    longitude: 122.8333,
  },
  {
    keywords: ['silay city', 'silay'],
    latitude: 10.8002,
    longitude: 122.9726,
  },
  {
    keywords: ['victorias city', 'victorias'],
    latitude: 10.9013,
    longitude: 123.0707,
  },
  {
    keywords: ['cadiz city', 'cadiz'],
    latitude: 10.9465,
    longitude: 123.2881,
  },
  {
    keywords: ['san carlos city', 'san carlos'],
    latitude: 10.4812,
    longitude: 123.4184,
  },
  {
    keywords: ['himamaylan city', 'himamaylan'],
    latitude: 10.1048,
    longitude: 122.8703,
  },
  {
    keywords: ['murcia'],
    latitude: 10.6056,
    longitude: 123.0417,
  },
  {
    keywords: ['la carlota city', 'la carlota'],
    latitude: 10.4247,
    longitude: 122.9212,
  },
  {
    keywords: ['sipalay city', 'sipalay'],
    latitude: 9.7514,
    longitude: 122.4665,
  },
  {
    keywords: ['bindoy', 'camudlas bindoy', 'camudlas', 'danawan bindoy', 'danawan'],
    latitude: 9.7573,
    longitude: 123.1392,
  },
  {
    keywords: ['basay'],
    latitude: 9.4442,
    longitude: 122.6339,
  },
  {
    keywords: ['bacong'],
    latitude: 9.2464,
    longitude: 123.2947,
  },
  {
    keywords: ['dumaguete city', 'dumaguete'],
    latitude: 9.3068,
    longitude: 123.3054,
  },
  {
    keywords: ['guihulngan city', 'guihulngan'],
    latitude: 10.1193,
    longitude: 123.2717,
  },
  {
    keywords: ['bais city', 'bais'],
    latitude: 9.5906,
    longitude: 123.1214,
  },
  {
    keywords: ['canlaon city', 'canlaon'],
    latitude: 10.3819,
    longitude: 123.1997,
  },
  {
    keywords: ['bayawan city', 'bayawan'],
    latitude: 9.3656,
    longitude: 122.8000,
  },
  {
    keywords: ['santa catalina', 'sta catalina', 'sta. catalina'],
    latitude: 9.3333,
    longitude: 123.2000,
  },
  {
    keywords: ['siaton'],
    latitude: 9.0667,
    longitude: 123.0333,
  },
  {
    keywords: ['zamboanguita'],
    latitude: 9.1167,
    longitude: 123.2000,
  },
  {
    keywords: ['valencia', 'valencia negros'],
    latitude: 9.2889,
    longitude: 123.2394,
  },
  {
    keywords: ['dauin'],
    latitude: 9.1833,
    longitude: 123.2667,
  },
  {
    keywords: ['manjuyod'],
    latitude: 9.6833,
    longitude: 123.1500,
  },
  {
    keywords: ['pamplona'],
    latitude: 9.5661,
    longitude: 123.0261,
  },
  {
    keywords: ['amlan'],
    latitude: 9.4500,
    longitude: 123.2000,
  },
  {
    keywords: ['tanjay city', 'tanjay'],
    latitude: 9.5167,
    longitude: 123.1667,
  },
  {
    keywords: ['jimalalud'],
    latitude: 9.9833,
    longitude: 123.2000,
  },
  {
    keywords: ['tayasan'],
    latitude: 9.8500,
    longitude: 123.0667,
  },
  {
    keywords: ['la libertad', 'lalibertad'],
    latitude: 9.8333,
    longitude: 123.1667,
  },
  {
    keywords: ['ayungon'],
    latitude: 9.8556,
    longitude: 123.1461,
  },
  {
    keywords: ['mabinay'],
    latitude: 9.7333,
    longitude: 122.9167,
  },
  {
    keywords: ['sibulan'],
    latitude: 9.3667,
    longitude: 123.2833,
  },
  {
    keywords: ['san jose', 'san jose negros'],
    latitude: 9.7667,
    longitude: 122.7333,
  },
  {
    keywords: ['hinoba-an', 'asia'],
    latitude: 10.2667,
    longitude: 122.5833,
  },
  {
    keywords: ['cauayan'],
    latitude: 10.3667,
    longitude: 122.7833,
  },
  {
    keywords: ['ilog'],
    latitude: 10.0667,
    longitude: 122.7167,
  },
  {
    keywords: ['candoni'],
    latitude: 9.8333,
    longitude: 122.6000,
  },
  {
    keywords: ['hinigaran'],
    latitude: 10.2667,
    longitude: 122.8500,
  },
  {
    keywords: ['isabela', 'isabela negros'],
    latitude: 10.2167,
    longitude: 122.9833,
  },
  {
    keywords: ['moises padilla', 'magallon'],
    latitude: 10.2667,
    longitude: 123.0833,
  },
  {
    keywords: ['pontevedra'],
    latitude: 10.3833,
    longitude: 122.8500,
  },
  {
    keywords: ['pulupandan'],
    latitude: 10.5167,
    longitude: 122.8000,
  },
  {
    keywords: ['valladolid'],
    latitude: 10.5000,
    longitude: 122.8333,
  },
  {
    keywords: ['san enrique'],
    latitude: 10.4167,
    longitude: 122.8167,
  },
  {
    keywords: ['toboso'],
    latitude: 10.7167,
    longitude: 123.5000,
  },
  {
    keywords: ['salvador benedicto'],
    latitude: 10.6333,
    longitude: 123.1333,
  },
  {
    keywords: ['calatrava'],
    latitude: 10.5983,
    longitude: 123.4731,
  },
  {
    keywords: ['escalante city', 'escalante'],
    latitude: 10.8408,
    longitude: 123.4939,
  },
  {
    keywords: ['manapla'],
    latitude: 10.9500,
    longitude: 123.1167,
  },
  {
    keywords: ['e.b. magalona', 'e b magalona', 'eb magalona', 'saravia'],
    latitude: 10.8833,
    longitude: 123.0167,
  },
  {
    keywords: ['badian'],
    latitude: 9.8647,
    longitude: 123.3967,
  },
  {
    keywords: ['alcantara'],
    latitude: 12.5167,
    longitude: 122.0000,
  },
  // LUZON - Major Cities and Provinces
  {
    keywords: ['quezon city', 'qc'],
    latitude: 14.6760,
    longitude: 121.0437,
  },
  {
    keywords: ['makati city', 'makati'],
    latitude: 14.5547,
    longitude: 121.0244,
  },
  {
    keywords: ['pasig city', 'pasig'],
    latitude: 14.5764,
    longitude: 121.0851,
  },
  {
    keywords: ['taguig city', 'taguig'],
    latitude: 14.5176,
    longitude: 121.0509,
  },
  {
    keywords: ['mandaluyong city', 'mandaluyong'],
    latitude: 14.5794,
    longitude: 121.0359,
  },
  {
    keywords: ['marikina city', 'marikina'],
    latitude: 14.6507,
    longitude: 121.1029,
  },
  {
    keywords: ['pasay city', 'pasay'],
    latitude: 14.5378,
    longitude: 120.9896,
  },
  {
    keywords: ['caloocan city', 'caloocan'],
    latitude: 14.6488,
    longitude: 120.9829,
  },
  {
    keywords: ['malabon city', 'malabon'],
    latitude: 14.6628,
    longitude: 120.9571,
  },
  {
    keywords: ['navotas city', 'navotas'],
    latitude: 14.6681,
    longitude: 120.9405,
  },
  {
    keywords: ['valenzuela city', 'valenzuela'],
    latitude: 14.6993,
    longitude: 120.9830,
  },
  {
    keywords: ['las piñas city', 'las pinas', 'las piñas', 'las pinas city'],
    latitude: 14.4453,
    longitude: 120.9832,
  },
  {
    keywords: ['muntinlupa city', 'muntinlupa'],
    latitude: 14.3810,
    longitude: 121.0437,
  },
  {
    keywords: ['parañaque city', 'paranaque', 'parañaque', 'paranaque city'],
    latitude: 14.4793,
    longitude: 121.0198,
  },
  {
    keywords: ['san juan city', 'san juan'],
    latitude: 14.6019,
    longitude: 121.0355,
  },
  {
    keywords: ['pateros'],
    latitude: 14.5428,
    longitude: 121.0658,
  },
  // Rizal Province
  {
    keywords: ['antipolo city', 'antipolo'],
    latitude: 14.5863,
    longitude: 121.1758,
  },
  {
    keywords: ['rodriguez', 'montalban'],
    latitude: 14.7336,
    longitude: 121.1219,
  },
  {
    keywords: ['cainta'],
    latitude: 14.5781,
    longitude: 121.1220,
  },
  {
    keywords: ['taytay', 'taytay rizal'],
    latitude: 14.5633,
    longitude: 121.1324,
  },
  {
    keywords: ['binangonan'],
    latitude: 14.4647,
    longitude: 121.1925,
  },
  {
    keywords: ['angono'],
    latitude: 14.5264,
    longitude: 121.1531,
  },
  {
    keywords: ['teresa', 'teresa rizal'],
    latitude: 14.5594,
    longitude: 121.2117,
  },
  {
    keywords: ['morong', 'morong rizal'],
    latitude: 14.5181,
    longitude: 121.2394,
  },
  {
    keywords: ['tanay'],
    latitude: 14.4989,
    longitude: 121.2867,
  },
  {
    keywords: ['pililla'],
    latitude: 14.4853,
    longitude: 121.3061,
  },
  {
    keywords: ['jala-jala', 'jalajala'],
    latitude: 14.3567,
    longitude: 121.3233,
  },
  {
    keywords: ['baras', 'baras rizal'],
    latitude: 14.5267,
    longitude: 121.2644,
  },
  {
    keywords: ['cardona'],
    latitude: 14.4872,
    longitude: 121.2292,
  },
  {
    keywords: ['san mateo', 'san mateo rizal'],
    latitude: 14.6972,
    longitude: 121.1225,
  },
  // Cavite Province
  {
    keywords: ['cavite city', 'cavite'],
    latitude: 14.4791,
    longitude: 120.8970,
  },
  {
    keywords: ['tagaytay city', 'tagaytay'],
    latitude: 14.1050,
    longitude: 120.9610,
  },
  {
    keywords: ['trece martires city', 'trece martires'],
    latitude: 14.2817,
    longitude: 120.8669,
  },
  {
    keywords: ['bacoor city', 'bacoor'],
    latitude: 14.4587,
    longitude: 120.9392,
  },
  {
    keywords: ['imus city', 'imus'],
    latitude: 14.4297,
    longitude: 120.9367,
  },
  {
    keywords: ['dasmariñas city', 'dasmarinas', 'dasmariñas', 'dasmarinas city'],
    latitude: 14.3294,
    longitude: 120.9367,
  },
  {
    keywords: ['general trias', 'gen trias'],
    latitude: 14.3869,
    longitude: 120.8811,
  },
  // Laguna Province
  {
    keywords: ['calamba city', 'calamba'],
    latitude: 14.2117,
    longitude: 121.1653,
  },
  {
    keywords: ['santa rosa city', 'santa rosa laguna'],
    latitude: 14.3123,
    longitude: 121.1115,
  },
  {
    keywords: ['biñan city', 'binan', 'biñan', 'binan city'],
    latitude: 14.3375,
    longitude: 121.0819,
  },
  {
    keywords: ['san pablo city', 'san pablo'],
    latitude: 14.0683,
    longitude: 121.3256,
  },
  {
    keywords: ['los baños', 'los banos', 'los baños laguna'],
    latitude: 14.1703,
    longitude: 121.2156,
  },
  {
    keywords: ['cabuyao city', 'cabuyao'],
    latitude: 14.2781,
    longitude: 121.1242,
  },
  {
    keywords: ['san pedro city', 'san pedro laguna'],
    latitude: 14.3553,
    longitude: 121.0178,
  },
  // Batangas Province
  {
    keywords: ['batangas city', 'batangas'],
    latitude: 13.7565,
    longitude: 121.0583,
  },
  {
    keywords: ['lipa city', 'lipa'],
    latitude: 13.9411,
    longitude: 121.1644,
  },
  {
    keywords: ['tanauan city', 'tanauan batangas'],
    latitude: 14.0856,
    longitude: 121.1497,
  },
  {
    keywords: ['santo tomas', 'santo tomas batangas'],
    latitude: 14.1078,
    longitude: 121.1414,
  },
  // Bulacan Province
  {
    keywords: ['malolos city', 'malolos'],
    latitude: 14.8433,
    longitude: 120.8114,
  },
  {
    keywords: ['meycauayan city', 'meycauayan'],
    latitude: 14.7350,
    longitude: 120.9550,
  },
  {
    keywords: ['san jose del monte city', 'san jose del monte', 'sjdm'],
    latitude: 14.8136,
    longitude: 121.0453,
  },
  {
    keywords: ['marilao'],
    latitude: 14.7572,
    longitude: 120.9481,
  },
  {
    keywords: ['bocaue'],
    latitude: 14.7989,
    longitude: 120.9256,
  },
  {
    keywords: ['santa maria', 'santa maria bulacan'],
    latitude: 14.8172,
    longitude: 120.9561,
  },
  // Pampanga Province
  {
    keywords: ['angeles city', 'angeles'],
    latitude: 15.1450,
    longitude: 120.5887,
  },
  {
    keywords: ['san fernando city', 'san fernando pampanga'],
    latitude: 15.0289,
    longitude: 120.6897,
  },
  {
    keywords: ['mabalacat city', 'mabalacat'],
    latitude: 15.2167,
    longitude: 120.5711,
  },
  // Nueva Ecija Province
  {
    keywords: ['cabanatuan city', 'cabanatuan'],
    latitude: 15.4860,
    longitude: 120.9670,
  },
  {
    keywords: ['gapan city', 'gapan'],
    latitude: 15.3086,
    longitude: 120.9447,
  },
  {
    keywords: ['palayan city', 'palayan'],
    latitude: 15.5425,
    longitude: 121.0839,
  },
  {
    keywords: ['science city of muñoz', 'munoz', 'muñoz'],
    latitude: 15.7108,
    longitude: 120.9039,
  },
  // Tarlac Province
  {
    keywords: ['tarlac city', 'tarlac'],
    latitude: 15.4754,
    longitude: 120.5964,
  },
  // Zambales Province
  {
    keywords: ['olongapo city', 'olongapo'],
    latitude: 14.8294,
    longitude: 120.2828,
  },
  {
    keywords: ['subic'],
    latitude: 14.8842,
    longitude: 120.2322,
  },
  // Pangasinan Province
  {
    keywords: ['dagupan city', 'dagupan'],
    latitude: 16.0433,
    longitude: 120.3333,
  },
  {
    keywords: ['urdaneta city', 'urdaneta'],
    latitude: 15.9761,
    longitude: 120.5711,
  },
  {
    keywords: ['alaminos city', 'alaminos'],
    latitude: 16.1556,
    longitude: 119.9819,
  },
  {
    keywords: ['san carlos city', 'san carlos pangasinan'],
    latitude: 15.9322,
    longitude: 120.3450,
  },
  // Ilocos Region
  {
    keywords: ['laoag city', 'laoag'],
    latitude: 18.1987,
    longitude: 120.5931,
  },
  {
    keywords: ['vigan city', 'vigan'],
    latitude: 17.5747,
    longitude: 120.3869,
  },
  {
    keywords: ['batac city', 'batac'],
    latitude: 18.0550,
    longitude: 120.5647,
  },
  {
    keywords: ['candon city', 'candon'],
    latitude: 17.1894,
    longitude: 120.4464,
  },
  // Cagayan Valley
  {
    keywords: ['tuguegarao city', 'tuguegarao'],
    latitude: 17.6132,
    longitude: 121.7270,
  },
  {
    keywords: ['santiago city', 'santiago isabela'],
    latitude: 16.6875,
    longitude: 121.5467,
  },
  {
    keywords: ['cauayan city', 'cauayan isabela'],
    latitude: 16.9286,
    longitude: 121.7708,
  },
  {
    keywords: ['ilagan city', 'ilagan'],
    latitude: 17.1489,
    longitude: 121.8847,
  },
  // Cordillera Administrative Region
  {
    keywords: ['baguio city', 'baguio'],
    latitude: 16.4023,
    longitude: 120.5960,
  },
  {
    keywords: ['bontoc'],
    latitude: 17.0889,
    longitude: 120.9775,
  },
  {
    keywords: ['la trinidad'],
    latitude: 16.4597,
    longitude: 120.5869,
  },
  // Bicol Region
  {
    keywords: ['naga city', 'naga'],
    latitude: 13.6192,
    longitude: 123.1814,
  },
  {
    keywords: ['legazpi city', 'legazpi'],
    latitude: 13.1391,
    longitude: 123.7438,
  },
  {
    keywords: ['tabaco city', 'tabaco'],
    latitude: 13.3594,
    longitude: 123.7347,
  },
  {
    keywords: ['ligao city', 'ligao'],
    latitude: 13.2181,
    longitude: 123.5306,
  },
  {
    keywords: ['sorsogon city', 'sorsogon'],
    latitude: 12.9742,
    longitude: 124.0078,
  },
  {
    keywords: ['iriga city', 'iriga'],
    latitude: 13.4211,
    longitude: 123.4169,
  },
  // VISAYAS - Central Visayas
  {
    keywords: ['mandaue city', 'mandaue'],
    latitude: 10.3237,
    longitude: 123.9227,
  },
  {
    keywords: ['lapu-lapu city', 'lapu-lapu', 'lapulapu'],
    latitude: 10.3103,
    longitude: 123.9494,
  },
  {
    keywords: ['tagbilaran city', 'tagbilaran'],
    latitude: 9.6475,
    longitude: 123.8536,
  },
  // Western Visayas
  {
    keywords: ['roxas city', 'roxas'],
    latitude: 11.5850,
    longitude: 122.7508,
  },
  {
    keywords: ['kalibo'],
    latitude: 11.7064,
    longitude: 122.3678,
  },
  {
    keywords: ['boracay'],
    latitude: 11.9674,
    longitude: 121.9247,
  },
  {
    keywords: ['bacolod city', 'bacolod'],
    latitude: 10.6765,
    longitude: 122.9509,
  },
  // Eastern Visayas
  {
    keywords: ['tacloban city', 'tacloban'],
    latitude: 11.2433,
    longitude: 125.0046,
  },
  {
    keywords: ['ormoc city', 'ormoc'],
    latitude: 11.0059,
    longitude: 124.6074,
  },
  {
    keywords: ['calbayog city', 'calbayog'],
    latitude: 12.0664,
    longitude: 124.5964,
  },
  {
    keywords: ['catbalogan city', 'catbalogan'],
    latitude: 11.7756,
    longitude: 124.8872,
  },
  {
    keywords: ['borongan city', 'borongan'],
    latitude: 11.6050,
    longitude: 125.4331,
  },
  // MINDANAO - Davao Region
  {
    keywords: ['tagum city', 'tagum'],
    latitude: 7.4479,
    longitude: 125.8078,
  },
  {
    keywords: ['panabo city', 'panabo'],
    latitude: 7.3072,
    longitude: 125.6836,
  },
  {
    keywords: ['samal city', 'island garden city of samal'],
    latitude: 7.0736,
    longitude: 125.7089,
  },
  {
    keywords: ['digos city', 'digos'],
    latitude: 6.7497,
    longitude: 125.3572,
  },
  {
    keywords: ['mati city', 'mati'],
    latitude: 6.9549,
    longitude: 126.2178,
  },
  // Northern Mindanao
  {
    keywords: ['iligan city', 'iligan'],
    latitude: 8.2280,
    longitude: 124.2452,
  },
  {
    keywords: ['malaybalay city', 'malaybalay'],
    latitude: 8.1531,
    longitude: 125.1278,
  },
  {
    keywords: ['valencia city', 'valencia bukidnon'],
    latitude: 7.9064,
    longitude: 125.0942,
  },
  {
    keywords: ['oroquieta city', 'oroquieta'],
    latitude: 8.4856,
    longitude: 123.8053,
  },
  {
    keywords: ['ozamiz city', 'ozamis', 'ozamiz'],
    latitude: 8.1489,
    longitude: 123.8414,
  },
  {
    keywords: ['tangub city', 'tangub'],
    latitude: 8.0647,
    longitude: 123.7494,
  },
  {
    keywords: ['gingoog city', 'gingoog'],
    latitude: 8.8256,
    longitude: 125.0986,
  },
  {
    keywords: ['el salvador city', 'el salvador'],
    latitude: 8.5333,
    longitude: 124.5167,
  },
  // Zamboanga Peninsula
  {
    keywords: ['pagadian city', 'pagadian'],
    latitude: 7.8250,
    longitude: 123.4356,
  },
  {
    keywords: ['dipolog city', 'dipolog'],
    latitude: 8.5833,
    longitude: 123.3417,
  },
  {
    keywords: ['dapitan city', 'dapitan'],
    latitude: 8.6542,
    longitude: 123.4236,
  },
  {
    keywords: ['isabela city', 'isabela basilan'],
    latitude: 6.7014,
    longitude: 121.9736,
  },
  // SOCCSKSARGEN
  {
    keywords: ['general santos city', 'general santos', 'gensan'],
    latitude: 6.1164,
    longitude: 125.1716,
  },
  {
    keywords: ['koronadal city', 'koronadal'],
    latitude: 6.5008,
    longitude: 124.8453,
  },
  {
    keywords: ['kidapawan city', 'kidapawan'],
    latitude: 7.0106,
    longitude: 125.0889,
  },
  {
    keywords: ['tacurong city', 'tacurong'],
    latitude: 6.6908,
    longitude: 124.6769,
  },
  // Caraga Region
  {
    keywords: ['butuan city', 'butuan'],
    latitude: 8.9475,
    longitude: 125.5406,
  },
  {
    keywords: ['surigao city', 'surigao'],
    latitude: 9.7847,
    longitude: 125.4908,
  },
  {
    keywords: ['tandag city', 'tandag'],
    latitude: 9.0758,
    longitude: 126.1997,
  },
  {
    keywords: ['bislig city', 'bislig'],
    latitude: 8.2086,
    longitude: 126.3203,
  },
  {
    keywords: ['bayugan city', 'bayugan'],
    latitude: 8.7142,
    longitude: 125.7444,
  },
  {
    keywords: ['cabadbaran city', 'cabadbaran'],
    latitude: 9.1233,
    longitude: 125.5344,
  },
  // BARMM
  {
    keywords: ['cotabato city', 'cotabato'],
    latitude: 7.2167,
    longitude: 124.2500,
  },
  {
    keywords: ['marawi city', 'marawi'],
    latitude: 7.9986,
    longitude: 124.2928,
  },
  {
    keywords: ['lamitan city', 'lamitan'],
    latitude: 6.6500,
    longitude: 122.1333,
  },
  // Palawan - MIMAROPA
  {
    keywords: ['puerto princesa city', 'puerto princesa'],
    latitude: 9.7392,
    longitude: 118.7353,
  },
  {
    keywords: ['coron'],
    latitude: 12.0008,
    longitude: 120.2078,
  },
  {
    keywords: ['el nido'],
    latitude: 11.1939,
    longitude: 119.4008,
  },
  {
    keywords: ['calapan city', 'calapan'],
    latitude: 13.4117,
    longitude: 121.1803,
  },
  {
    keywords: ['central visayas', 'region vii', 'region 7'],
    latitude: 10.3157,
    longitude: 123.8854,
  },
  {
    keywords: ['region vi', 'region 6', 'western visayas'],
    latitude: 10.7202,
    longitude: 122.5621,
  },
  {
    keywords: ['region iv a', 'calabarzon'],
    latitude: 14.1008,
    longitude: 121.0794,
  },
  {
    keywords: ['region iii', 'region 3', 'central luzon'],
    latitude: 15.4828,
    longitude: 120.712,
  },
  {
    keywords: ['region i ', 'region 1', 'ilocos region'],
    latitude: 16.0832,
    longitude: 120.6199,
  },
  {
    keywords: ['region ii', 'region 2', 'cagayan valley'],
    latitude: 17.6132,
    longitude: 121.727,
  },
  {
    keywords: ['mimaropa', 'region iv b', 'region 4 b'],
    latitude: 12.1896,
    longitude: 121.3063,
  },
  {
    keywords: ['bicol region', 'region v', 'region 5'],
    latitude: 13.1391,
    longitude: 123.7438,
  },
  {
    keywords: ['eastern visayas', 'region viii', 'region 8'],
    latitude: 11.2433,
    longitude: 125.0046,
  },
  {
    keywords: ['zamboanga peninsula', 'region ix', 'region 9'],
    latitude: 7.8383,
    longitude: 123.2967,
  },
  {
    keywords: ['northern mindanao', 'region x', 'region 10'],
    latitude: 8.4542,
    longitude: 124.6319,
  },
  {
    keywords: ['davao region', 'region xi', 'region 11'],
    latitude: 7.1907,
    longitude: 125.4553,
  },
  {
    keywords: ['soccsksargen', 'region xii', 'region 12'],
    latitude: 6.1164,
    longitude: 125.1716,
  },
  {
    keywords: ['caraga', 'region xiii', 'region 13'],
    latitude: 8.9475,
    longitude: 125.5406,
  },
  {
    keywords: ['cordillera administrative region', 'region xiv'],
    latitude: 16.4023,
    longitude: 120.596,
  },
  {
    keywords: ['barmm', 'bangsamoro'],
    latitude: 7.2167,
    longitude: 124.25,
  },
  {
    keywords: ['negros occidental'],
    latitude: 10.5,
    longitude: 123.0,
  },
  {
    keywords: ['negros island region', 'nir'],
    latitude: 10.68,
    longitude: 122.97,
  },
  {
    keywords: ['philippines', 'philippine', 'pinas'],
    latitude: 12.8797,
    longitude: 121.7740,
  },
  {
    keywords: ['metro manila', 'manila', 'ncr', 'national capital region'],
    latitude: 14.5995,
    longitude: 120.9842,
  },
  {
    keywords: ['cebu city', 'cebu'],
    latitude: 10.3157,
    longitude: 123.8854,
  },
  {
    keywords: ['davao city', 'davao'],
    latitude: 7.1907,
    longitude: 125.4553,
  },
  {
    keywords: ['iloilo city', 'iloilo'],
    latitude: 10.7202,
    longitude: 122.5621,
  },
  {
    keywords: ['cagayan de oro', 'cdo'],
    latitude: 8.4542,
    longitude: 124.6319,
  },
  {
    keywords: ['zamboanga city', 'zamboanga'],
    latitude: 6.9214,
    longitude: 122.0790,
  },
];

const PROVINCE_CENTERS: Record<string, { lat: number; lng: number }> = {
  'basilan': { lat: 6.7014, lng: 121.9736 },
  'lanao del sur': { lat: 7.9986, lng: 124.2928 },
  'maguindanao del sur': { lat: 7.0625, lng: 124.4431 },
  'maguindanao del norte': { lat: 7.2500, lng: 124.4500 },
  'tawi-tawi': { lat: 5.0500, lng: 119.9500 },
  'sulu': { lat: 5.9750, lng: 121.0000 },
  'misamis occidental': { lat: 8.4856, lng: 123.8053 },
  'misamis oriental': { lat: 8.5042, lng: 124.6219 },
  'lanao del norte': { lat: 8.1108, lng: 124.0147 },
  'bukidnon': { lat: 8.0569, lng: 125.0489 },
  'camiguin': { lat: 9.1667, lng: 124.7167 },
  'city of cagayan de oro': { lat: 8.4542, lng: 124.6319 },
  'city of iligan': { lat: 8.2280, lng: 124.2452 },
  'davao del norte': { lat: 7.5617, lng: 125.7444 },
  'davao oriental': { lat: 7.3167, lng: 126.1833 },
  'davao del sur': { lat: 6.7661, lng: 125.3572 },
  'city of davao': { lat: 7.1907, lng: 125.4553 },
  'davao de oro': { lat: 7.7189, lng: 126.0567 },
  'davao occidental': { lat: 6.1500, lng: 125.6000 },
  'sarangani': { lat: 5.9500, lng: 125.3833 },
  'cotabato': { lat: 7.2500, lng: 124.9500 },
  'sultan kudarat': { lat: 6.5058, lng: 124.5797 },
  'south cotabato': { lat: 6.2983, lng: 124.8500 },
  'city of general santos': { lat: 6.1164, lng: 125.1716 },
  'city of caloocan': { lat: 14.6488, lng: 120.9829 },
  'city of las piñas': { lat: 14.4453, lng: 120.9832 },
  'city of makati': { lat: 14.5547, lng: 121.0244 },
  'city of malabon': { lat: 14.6628, lng: 120.9571 },
  'city of mandaluyong': { lat: 14.5794, lng: 121.0359 },
  'city of manila': { lat: 14.5995, lng: 120.9842 },
  'city of marikina': { lat: 14.6507, lng: 121.1029 },
  'city of muntinlupa': { lat: 14.3810, lng: 121.0437 },
  'city of navotas': { lat: 14.6681, lng: 120.9405 },
  'city of parañaque': { lat: 14.4793, lng: 121.0198 },
  'city of pasig': { lat: 14.5764, lng: 121.0851 },
  'city of san juan': { lat: 14.6019, lng: 121.0355 },
  'city of taguig': { lat: 14.5176, lng: 121.0509 },
  'city of valenzuela': { lat: 14.6993, lng: 120.9830 },
  'pasay city': { lat: 14.5378, lng: 120.9896 },
  'quezon city': { lat: 14.6760, lng: 121.0437 },
  'ifugao': { lat: 16.8300, lng: 121.1710 },
  'benguet': { lat: 16.4023, lng: 120.5960 },
  'kalinga': { lat: 17.4667, lng: 121.3500 },
  'abra': { lat: 17.5951, lng: 120.7183 },
  'mountain province': { lat: 17.0889, lng: 120.9775 },
  'apayao': { lat: 18.0111, lng: 121.1069 },
  'city of baguio': { lat: 16.4023, lng: 120.5960 },
  'surigao del norte': { lat: 9.7847, lng: 125.4908 },
  'surigao del sur': { lat: 8.7500, lng: 126.1500 },
  'dinagat islands': { lat: 10.1333, lng: 125.6000 },
  'agusan del norte': { lat: 8.9475, lng: 125.5406 },
  'agusan del sur': { lat: 8.5417, lng: 125.9500 },
  'city of butuan': { lat: 8.9475, lng: 125.5406 },
  'palawan': { lat: 9.7392, lng: 118.7353 },
  'occidental mindoro': { lat: 12.8833, lng: 120.8833 },
  'romblon': { lat: 12.5867, lng: 122.2717 },
  'oriental mindoro': { lat: 12.8500, lng: 121.2833 },
  'marinduque': { lat: 13.4000, lng: 121.9833 },
  'city of puerto princesa': { lat: 9.7392, lng: 118.7353 },
  'negros oriental': { lat: 9.6500, lng: 123.1000 },
  'negros occidental': { lat: 10.2000, lng: 122.8500 },
  'city of bacolod': { lat: 10.6765, lng: 122.9509 },
  'siquijor': { lat: 9.2000, lng: 123.5167 },
  'ilocos norte': { lat: 18.1987, lng: 120.5931 },
  'pangasinan': { lat: 16.0167, lng: 120.3333 },
  'la union': { lat: 16.6159, lng: 120.3209 },
  'ilocos sur': { lat: 17.5747, lng: 120.3869 },
  'cagayan': { lat: 17.6132, lng: 121.7270 },
  'quirino': { lat: 16.4833, lng: 121.5833 },
  'nueva vizcaya': { lat: 16.4083, lng: 121.1500 },
  'isabela': { lat: 16.9286, lng: 121.7708 },
  'batanes': { lat: 20.4500, lng: 121.9700 },
  'bataan': { lat: 14.6417, lng: 120.4833 },
  'nueva ecija': { lat: 15.4860, lng: 120.9670 },
  'tarlac': { lat: 15.4754, lng: 120.5964 },
  'bulacan': { lat: 14.8433, lng: 120.8114 },
  'pampanga': { lat: 15.0289, lng: 120.6897 },
  'aurora': { lat: 15.9833, lng: 121.6333 },
  'zambales': { lat: 14.8294, lng: 120.2828 },
  'city of angeles': { lat: 15.1450, lng: 120.5887 },
  'city of olongapo': { lat: 14.8294, lng: 120.2828 },
  'quezon': { lat: 14.0395, lng: 122.0000 },
  'batangas': { lat: 13.7565, lng: 121.0583 },
  'laguna': { lat: 14.2700, lng: 121.4500 },
  'cavite': { lat: 14.4791, lng: 120.8970 },
  'rizal': { lat: 14.5863, lng: 121.1758 },
  'city of lucena': { lat: 13.9373, lng: 121.6173 },
  'zamboanga sibugay': { lat: 7.5917, lng: 122.8833 },
  'zamboanga del sur': { lat: 7.8250, lng: 123.4356 },
  'zamboanga del norte': { lat: 8.5833, lng: 123.3417 },
  'city of zamboanga': { lat: 6.9214, lng: 122.0790 },
  'masbate': { lat: 12.3637, lng: 123.6233 },
  'camarines sur': { lat: 13.6192, lng: 123.1814 },
  'albay': { lat: 13.1391, lng: 123.7438 },
  'catanduanes': { lat: 13.7167, lng: 124.2333 },
  'sorsogon': { lat: 12.9742, lng: 124.0078 },
  'camarines norte': { lat: 14.1389, lng: 122.7636 },
  'iloilo': { lat: 10.7202, lng: 122.5621 },
  'aklan': { lat: 11.7064, lng: 122.3678 },
  'antique': { lat: 11.3667, lng: 121.9500 },
  'guimaras': { lat: 10.5886, lng: 122.6253 },
  'city of iloilo': { lat: 10.7202, lng: 122.5621 },
  'capiz': { lat: 11.5850, lng: 122.7508 },
  'bohol': { lat: 9.8500, lng: 124.0167 },
  'cebu': { lat: 10.3157, lng: 123.8854 },
  'city of cebu': { lat: 10.3157, lng: 123.8854 },
  'city of lapu-lapu': { lat: 10.3103, lng: 123.9494 },
  'city of mandaue': { lat: 10.3237, lng: 123.9227 },
  'leyte': { lat: 10.4167, lng: 124.9500 },
  'northern samar': { lat: 12.3500, lng: 124.3500 },
  'samar': { lat: 11.7756, lng: 124.8872 },
  'biliran': { lat: 11.5833, lng: 124.4667 },
  'southern leyte': { lat: 10.3333, lng: 125.0500 },
  'eastern samar': { lat: 11.5000, lng: 125.5000 },
  'city of tacloban': { lat: 11.2433, lng: 125.0046 },
};

const PHILIPPINES_PLACE_KEYWORDS = [
  'philippines',
  'philippine',
  'pinas',
  'metro manila',
  'manila',
  'ncr',
  'national capital region',
  'luzon',
  'visayas',
  'mindanao',
  'barangay',
  'brgy',
  'brgy.',
  'purok',
  'sitio',
  'poblacion',
  'barangay',
  'municipality',
  'mun',
  'mun.',
  'province',
  'city',
  'city.',
  'batangas',
  'cavite',
  'laguna',
  'rizal',
  'quezon',
  'pampanga',
  'bulacan',
  'pangasinan',
  'nova ecija',
  'tarlac',
  'zambales',
  'bataan',
  'albay',
  'camarines',
  'sorsogon',
  'naga',
  'cebu',
  'davao',
  'cagayan de oro',
  'zamboanga',
  'iligan',
  'general santos',
  'bukidnon',
  'surigao',
  'cotabato',
  'palawan',
  'siargao',
  'batangas',
  'biliran',
  'basilan',
  'batanes',
  'border',
  'dinagat',
  'guimaras',
  'ifugao',
  'kalinga',
  'mountain province',
  'occidental mindoro',
  'oriental mindoro',
  'marinduque',
  'romblon',
  'samar',
  'leyte',
  'biliran',
  'southern leyte',
  'northern samar',
  'western samar',
  'agusan',
  'sultan kudarat',
  'south cotabato',
  'north cotabato',
  'sarangani',
  'dinagat islands',
  'tawi tawi',
  'sulu',
  'lamitan',
  'marawi',
  'iriga',
];

function normalizePlaceValue(value: string | undefined | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasUsableCoordinates(location?: Partial<Project['location']> | null): location is ProjectCoordinates {
  return Boolean(
    location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      !(location.latitude === 0 && location.longitude === 0)
  );
}

function getProjectLocationAddress(project: Pick<Project, 'location'>): string {
  return project.location?.address?.trim() || '';
}

function inferCoordinatesFromRelatedProject(
  project: Project,
  projects: Project[]
): { coordinates: ProjectCoordinates; address?: string } | null {
  const otherProjects = projects.filter(candidate => candidate.id !== project.id);
  const normalizedTitle = normalizePlaceValue(project.title);

  if (normalizedTitle) {
    const sameTitleMatch = otherProjects.find(candidate =>
      normalizePlaceValue(candidate.title) === normalizedTitle && hasUsableCoordinates(candidate.location)
    );

    if (sameTitleMatch) {
      return {
        coordinates: {
          latitude: sameTitleMatch.location.latitude,
          longitude: sameTitleMatch.location.longitude,
        },
        address: getProjectLocationAddress(sameTitleMatch),
      };
    }
  }

  if (project.parentProjectId) {
    const parentMatch = otherProjects.find(candidate =>
      candidate.id === project.parentProjectId && hasUsableCoordinates(candidate.location)
    );

    if (parentMatch) {
      return {
        coordinates: {
          latitude: parentMatch.location.latitude,
          longitude: parentMatch.location.longitude,
        },
        address: getProjectLocationAddress(parentMatch),
      };
    }

    const siblingMatch = otherProjects.find(candidate =>
      candidate.parentProjectId === project.parentProjectId && hasUsableCoordinates(candidate.location)
    );

    if (siblingMatch) {
      return {
        coordinates: {
          latitude: siblingMatch.location.latitude,
          longitude: siblingMatch.location.longitude,
        },
        address: getProjectLocationAddress(siblingMatch),
      };
    }
  }

  const childMatch = otherProjects.find(candidate =>
    candidate.parentProjectId === project.id && hasUsableCoordinates(candidate.location)
  );

  if (childMatch) {
    return {
      coordinates: {
        latitude: childMatch.location.latitude,
        longitude: childMatch.location.longitude,
      },
      address: getProjectLocationAddress(childMatch),
    };
  }

  const inferredFromAddress = inferCoordinatesFromPlace(getProjectLocationAddress(project), otherProjects);
  if (inferredFromAddress) {
    return {
      coordinates: inferredFromAddress,
      address: getProjectLocationAddress(project),
    };
  }

  return null;
}

function resolveProjectMapPlacement(project: Project, projects: Project[]): Project {
  if (hasUsableCoordinates(project.location)) {
    return project;
  }

  const inferredPlacement = inferCoordinatesFromRelatedProject(project, projects);
  if (inferredPlacement) {
    return {
      ...project,
      location: {
        address: getProjectLocationAddress(project) || inferredPlacement.address || 'Location to be finalized',
        latitude: inferredPlacement.coordinates.latitude,
        longitude: inferredPlacement.coordinates.longitude,
      },
    };
  }

  // Last resort: try to infer from the project's own address string against known places
  const addressOnly = inferCoordinatesFromPlace(getProjectLocationAddress(project), []);
  if (addressOnly) {
    return {
      ...project,
      location: {
        address: getProjectLocationAddress(project) || 'Location to be finalized',
        latitude: addressOnly.latitude,
        longitude: addressOnly.longitude,
      },
    };
  }

  // Final fallback: place unmapped projects at the Negros Occidental center so they
  // still appear on the map with a visible warning in the callout instead of disappearing.
  return {
    ...project,
    location: {
      address: getProjectLocationAddress(project) || 'Location to be finalized',
      latitude: NEGROS_REGION.latitude,
      longitude: NEGROS_REGION.longitude,
    },
  };
}

function spreadOverlappingProjectMarkers(projects: Project[]): Project[] {
  const projectsByCoordinateKey = new Map<string, Project[]>();

  projects.forEach(project => {
    const coordinateKey = `${project.location.latitude.toFixed(5)}:${project.location.longitude.toFixed(5)}`;
    const entries = projectsByCoordinateKey.get(coordinateKey) || [];
    entries.push(project);
    projectsByCoordinateKey.set(coordinateKey, entries);
  });

  return projects.flatMap(project => {
    const coordinateKey = `${project.location.latitude.toFixed(5)}:${project.location.longitude.toFixed(5)}`;
    const overlappingProjects = projectsByCoordinateKey.get(coordinateKey) || [];

    if (overlappingProjects.length <= 1) {
      return project;
    }

    const projectIndex = overlappingProjects.findIndex(entry => entry.id === project.id);
    if (projectIndex === -1) {
      return project;
    }

    const angle = (Math.PI * 2 * projectIndex) / overlappingProjects.length;
    const radius = 0.0035;
    const latitudeOffset = Math.sin(angle) * radius;
    const longitudeOffset = Math.cos(angle) * radius;

    return {
      ...project,
      location: {
        ...project.location,
        latitude: project.location.latitude + latitudeOffset,
        longitude: project.location.longitude + longitudeOffset,
      },
    };
  });
}

export function inferCoordinatesFromPlace(
  place: string,
  projects: Array<Pick<Project, 'location'>> = [],
  allowProvinceFallback = true
): ProjectCoordinates | null {
  const normalizedPlace = normalizePlaceValue(place);
  if (!normalizedPlace) {
    return null;
  }

  const exactProjectMatch = projects.find(project => {
    const normalizedAddress = normalizePlaceValue(project.location?.address);
    return normalizedAddress === normalizedPlace && hasUsableCoordinates(project.location);
  });

  if (exactProjectMatch) {
    return {
      latitude: exactProjectMatch.location.latitude,
      longitude: exactProjectMatch.location.longitude,
    };
  }

  const relatedProjectMatch = projects.find(project => {
    const normalizedAddress = normalizePlaceValue(project.location?.address);
    const isGeneric =
      normalizedAddress === 'negros island region nir' ||
      normalizedAddress === 'negros occidental' ||
      normalizedAddress === 'philippines' ||
      (project.location?.latitude === 10.68 && project.location?.longitude === 122.97) ||
      (project.location?.latitude === 10.5 && project.location?.longitude === 123.0) ||
      (project.location?.latitude === 12.8797 && project.location?.longitude === 121.774) ||
      (project.location?.latitude === 10.4 && project.location?.longitude === 123.05);

    return (
      normalizedAddress &&
      !isGeneric &&
      (normalizedAddress.includes(normalizedPlace) ||
        normalizedPlace.includes(normalizedAddress)) &&
      hasUsableCoordinates(project.location)
    );
  });

  if (relatedProjectMatch) {
    return {
      latitude: relatedProjectMatch.location.latitude,
      longitude: relatedProjectMatch.location.longitude,
    };
  }

  const keywordMatch = KNOWN_PLACE_COORDINATES.find(entry =>
    entry.keywords.some(keyword => normalizedPlace.includes(keyword))
  );

  if (keywordMatch) {
    return {
      latitude: keywordMatch.latitude,
      longitude: keywordMatch.longitude,
    };
  }

  // Fallback: Check if the address contains any known province names
  if (allowProvinceFallback) {
    const matchedProvince = Object.keys(PROVINCE_CENTERS).find(province =>
      normalizedPlace.includes(province)
    );

    if (matchedProvince) {
      const coords = PROVINCE_CENTERS[matchedProvince];
      return {
        latitude: coords.lat,
        longitude: coords.lng,
      };
    }
  }

  // No specific place found - do NOT default to Philippines ocean center.
  // Return null and let the caller handle appropriate fallback logic.
  return null;
}

// Shared map constants and helpers for project and event map screens.

export const PHILIPPINES_REGION = {
  latitude: 12.8797,
  longitude: 121.774,
  latitudeDelta: 8.5,
  longitudeDelta: 8.5,
};

export const PHILIPPINES_WEB_CENTER = {
  lat: PHILIPPINES_REGION.latitude,
  lng: PHILIPPINES_REGION.longitude,
};

export const PHILIPPINES_BOUNDS = {
  south: 4.5,
  west: 116.5,
  north: 21.5,
  east: 127.5,
};

export const NEGROS_REGION = {
  latitude: 10.4,
  longitude: 123.05,
  latitudeDelta: 0.85,
  longitudeDelta: 0.8,
};

export const IMPACT_MAP_MIN_REGION = {
  latitudeDelta: 4.8,
  longitudeDelta: 4.8,
};

// Returns the marker color for a project or event based only on lifecycle status.
export function getProjectMarkerColor(
  project: Pick<Project, 'isEvent' | 'status' | 'startDate' | 'endDate'>
) {
  return getProjectStatusColor(project);
}

export function getMappedProjects(projects: Project[]): Project[] {
  // Filter out programs (top-level items that are neither events nor have a parent)
  // Only show projects and events on the map
  const projectsAndEvents = projects.filter(project => {
    // If it has a parent, it's a project or event under a program - include it
    if (project.parentProjectId) {
      return true;
    }
    // If it's marked as an event, include it
    if (project.isEvent) {
      return true;
    }
    // Otherwise, it's a top-level program - exclude it
    return false;
  });

  const resolvedProjects = projectsAndEvents
    .map(project => resolveProjectMapPlacement(project, projects))
    .filter(project => hasUsableCoordinates(project.location));

  return spreadOverlappingProjectMarkers(resolvedProjects);
}

// Returns projects that could not be placed on the map (no coordinates and no resolvable address).
export function getUnmappedProjects(projects: Project[]): Project[] {
  return projects.filter(project => {
    const resolved = resolveProjectMapPlacement(project, projects);
    // A project is truly unmapped only if it still has no usable coordinates after all resolution
    // attempts AND its address is a placeholder (meaning the user never entered a real location).
    const address = getProjectLocationAddress(resolved);
    const isPlaceholder =
      !address ||
      address === 'Location to be finalized' ||
      address === 'Program location to be finalized';
    return isPlaceholder && !hasUsableCoordinates(project.location);
  });
}

// Computes an initial map region that keeps all known projects in view.
export function getInitialProjectRegion(projects: Project[]) {
  const mappedProjects = getMappedProjects(projects);

  if (mappedProjects.length === 0) {
    return NEGROS_REGION;
  }

  const latitudes = mappedProjects.map(project => project.location.latitude);
  const longitudes = mappedProjects.map(project => project.location.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(
      (maxLatitude - minLatitude) * 1.8,
      IMPACT_MAP_MIN_REGION.latitudeDelta
    ),
    longitudeDelta: Math.max(
      (maxLongitude - minLongitude) * 1.8,
      IMPACT_MAP_MIN_REGION.longitudeDelta
    ),
  };
}
