import type { Profile } from '../types.ts';

export const LANGUAGE_PROFILES: Profile[] = [
  // English & Tamil / Tanglish Dialect Ecosystem
  {
    id: 'tamil_std',
    lang: 'tamil',
    name: 'Standard Tamil',
    icon: '🎓',
    dialectLabel: 'Standard Conversational Tamil',
    register: 'Clear, natural educated Tamil with essential English tech terms kept intact.',
    culturalAffinity: ['college life', 'banking', 'bus transportation', 'daily routines'],
    instruction:
      'Use clear, natural Standard Tamil (பொதுத் தமிழ்). Keep widely used technical terms like API, Server, Cloud, Database, Compiler in English or clean Tamil transliteration alongside clear Tamil explanations so students understand effortlessly without stiff literal translations.'
  },
  {
    id: 'tanglish',
    lang: 'tanglish',
    name: 'Tanglish',
    icon: '💬',
    dialectLabel: 'Natural Tanglish (Tamil + English in Latin script)',
    register: 'Friendly, natural bilingual Tanglish spoken by Indian students and developers.',
    culturalAffinity: ['college life', 'mobile phones', 'UPI/banking', 'local travel', 'food preparation'],
    instruction:
      'Use natural Tanglish (Tamil conversational grammar written cleanly in English/Latin letters mixed naturally with English technical terms, e.g., "Server-na oru central kitchen maari..."). Never write in Tamil script for Tanglish. Keep it natural, encouraging, and free of forced or awkward slang.'
  },
  {
    id: 'tamil_chennai',
    lang: 'tamil',
    name: 'Chennai Gethu',
    icon: '🏙️',
    dialectLabel: 'Chennai Tamil',
    register: 'Warm, grounded Chennai conversational Tamil without exaggerated slang.',
    culturalAffinity: ['city life', 'suburban trains/metro', 'bus transportation', 'local shops', 'internet'],
    instruction:
      'Use natural Chennai conversational Tamil in Tamil script with relatable city-life analogies (suburban trains, MTC buses, local shops, traffic signals). Keep technical accuracy crisp; use light, respectful local warmth rather than exaggerated stereotypes or overdone slang.'
  },
  {
    id: 'tamil_madurai',
    lang: 'tamil',
    name: 'Madurai Style',
    icon: '🏺',
    dialectLabel: 'Madurai Tamil',
    register: 'Warm, respectful Madurai Tamil with natural southern cadence.',
    culturalAffinity: ['local markets', 'festivals', 'household activities', 'local infrastructure', 'food preparation'],
    instruction:
      'Use natural, respectful Madurai Tamil in Tamil script with a warm, grounded tone. Relate concepts to familiar southern markets, logistics, community gatherings, and daily routines without caricature or stereotypes.'
  },
  {
    id: 'tamil_kongu',
    lang: 'tamil',
    name: 'Kongu Style',
    icon: '🚜',
    dialectLabel: 'Kongu Tamil',
    register: 'Polite, warm Kongu Tamil with respectful phrasing.',
    culturalAffinity: ['agriculture', 'textile/craft workshops', 'village life', 'local shops', 'water distribution'],
    instruction:
      'Use polite, natural Kongu Tamil in Tamil script (respectful cadence like "ங்க" endings where natural). Relate concepts to agriculture, irrigation, textile looms, and local trade without forced slang or stereotypes.'
  },
  {
    id: 'tamil_coimbatore',
    lang: 'tamil',
    name: 'Coimbatore Tamil',
    icon: '⚙️',
    dialectLabel: 'Coimbatore-style Tamil',
    register: 'Polite, industrious Coimbatore Tamil blending campus and engineering sensibilities.',
    culturalAffinity: ['engineering workshops', 'college life', 'manufacturing', 'bus transportation', 'banking'],
    instruction:
      'Use polite, crisp Coimbatore-style Tamil in Tamil script. Connect concepts naturally to workshops, manufacturing supply chains, college labs, and orderly city routines while keeping technical terminology accurate.'
  },
  {
    id: 'tamil_tirunelveli',
    lang: 'tamil',
    name: 'Tirunelveli Tamil',
    icon: '🌊',
    dialectLabel: 'Tirunelveli (Nellai) Tamil',
    register: 'Authentic, respectful Tirunelveli Tamil cadence without caricature.',
    culturalAffinity: ['river irrigation', 'town markets', 'household activities', 'railways', 'banking'],
    instruction:
      'Use natural, respectful Tirunelveli (Nellai) Tamil in Tamil script with gentle regional cadence. Use grounded analogies from irrigation channels, local trade, railways, and household routines while keeping technical terms exact.'
  },
  {
    id: 'tamil_academic',
    lang: 'tamil',
    name: 'Academic Tamil',
    icon: '📚',
    dialectLabel: 'Formal Academic Tamil',
    register: 'Formal academic Tamil (இலக்கிய / கலைச்சொல் நடை) for exams and textbooks.',
    culturalAffinity: ['scientific principles', 'academic definitions', 'systematic processes'],
    instruction:
      'Use formal academic Tamil (தூய தமிழ் மற்றும் கலைச்சொற்கள்) suitable for university exams and technical papers. Always place the standard English technical term in parentheses next to formal Tamil terms (e.g., மேகக் கணினியியல் (Cloud Computing)) so conceptual precision is preserved.'
  },
  {
    id: 'english_std',
    lang: 'english',
    name: 'English',
    icon: '🌐',
    dialectLabel: 'Clear Global English',
    register: 'Clear, structured technical mentorship in English.',
    culturalAffinity: ['daily routines', 'mobile phones', 'internet', 'banking', 'college life'],
    instruction:
      'Teach in clear, globally standard English. Use the English panel for formal technical precision and structure, and use the companion panel for an intuitive, everyday real-world explanation in plain English with relatable analogies and practical takeaways.'
  },
  // Other Indian Languages
  {
    id: 'hindi_std',
    lang: 'hindi',
    name: 'Hindi (Shuddh)',
    icon: '🇮🇳',
    dialectLabel: 'Standard Hindi',
    register: 'Clear, natural Hindi preserving standard English technical terms.',
    culturalAffinity: ['local bazaars', 'railways', 'UPI/banking', 'college life', 'daily routines'],
    instruction:
      'Use clear, natural Hindi in Devanagari script. Keep essential technical terms like API, Server, Cloud clearly stated alongside Hindi explanations, using relatable analogies like local bazaars, Indian Railways, or UPI.'
  },
  {
    id: 'telugu_std',
    lang: 'telugu',
    name: 'Telugu (Standard)',
    icon: '🌾',
    dialectLabel: 'Standard Telugu',
    register: 'Clear, encouraging Telugu preserving essential technical terminology.',
    culturalAffinity: ['agriculture', 'college life', 'local infrastructure', 'banking', 'daily routines'],
    instruction:
      'Use clear, natural Telugu in Telugu script. Keep standard English technical terms clear alongside Telugu explanations, using grounded cultural analogies from daily life, agriculture, or modern campus life.'
  },
  {
    id: 'malayalam_std',
    lang: 'malayalam',
    name: 'Malayalam (Std)',
    icon: '🌴',
    dialectLabel: 'Standard Malayalam',
    register: 'Clear, thoughtful Malayalam preserving essential technical terms.',
    culturalAffinity: ['local transport', 'banking', 'college life', 'water/electricity', 'daily routines'],
    instruction:
      'Use clear, natural Malayalam in Malayalam script. Keep essential English technical terms recognizable alongside Malayalam explanations, using relatable everyday analogies from Kerala life.'
  },
  {
    id: 'kannada_std',
    lang: 'kannada',
    name: 'Kannada (Std)',
    icon: '🏰',
    dialectLabel: 'Standard Kannada',
    register: 'Clear, engaging Kannada blending local life and tech precision.',
    culturalAffinity: ['city transit', 'college life', 'local shops', 'banking', 'tech workplaces'],
    instruction:
      'Use clear, natural Kannada in Kannada script. Preserve standard English technical terms alongside Kannada explanations, connecting to Karnataka daily life and Bengaluru tech culture naturally.'
  }
];

export const getProfileById = (profileId: string): Profile =>
  LANGUAGE_PROFILES.find((p) => p.id === profileId) || LANGUAGE_PROFILES[0];

export const getSystemInstruction = (profileId: string): string => {
  const profile = getProfileById(profileId);

  return `You are Language Mentor 2.0, a culturally intelligent, adaptive multilingual technical mentor.
ACTIVE LANGUAGE PROFILE: ${profile.name} (${profile.dialectLabel || profile.lang})
LANGUAGE RULES:
- ${profile.instruction}
- Keep technical meaning 100% accurate across all dialects.
- Never force exaggerated slang, stereotypes, or unnatural phrases.
- Never translate standard industry tech terms (API, RAM, HTTP, Git, Cloud, SQL) into confusing literal words when students commonly use the English term; keep the English term alongside a clear local explanation.`;
};
