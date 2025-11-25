// Pro Website Questionnaire Data
export const SERVICE_OPTIONS_GROUPED = {
  "Cloud & Infrastructure": [
    "Cloud Services",
    "Hybrid Cloud Services",
    "Internet Services",
    "Microsoft 365",
    "Private Cloud Services",
    "Structured Cabling"
  ],
  "Compliance": [
    "CMMC Compliance",
    "FTC Compliance",
    "HIPAA Compliance",
    "IT Compliance",
    "NIST Framework Compliance",
    "PCI Compliance",
    "SOC2 Compliance"
  ],
  "IT Services": [
    "Co-Managed IT",
    "Hourly IT Support",
    "IT Consulting",
    "IT Help Desk",
    "Managed IT",
    "Outsourced IT Help Desk"
  ],
  "Security": [
    "Cybersecurity",
    "Ransomware Removal",
    "Security Awareness Training",
    "Video Surveillance Solutions"
  ],
  "Hardware & Recovery": [
    "Data Backup & Recovery",
    "Disaster Recovery Planning",
    "Hardware as a Service",
    "Printer & Office Machine",
    "VoIP Phone Systems"
  ]
};

export const SERVICE_OPTIONS = Object.values(SERVICE_OPTIONS_GROUPED).flat();

export const INDUSTRY_OPTIONS = [
  "Agriculture / Farming",
  "Dental Practices",
  "Energy / Oil & Gas",
  "Engineering / Architecture Firms",
  "Financial / Accounting / CPA",
  "Government / Municipalities",
  "Healthcare / Medical",
  "Insurance Agencies",
  "Legal Firms",
  "Manufacturing / Construction",
  "Nonprofits / Education",
  "Professional Services (Marketing, Real Estate, etc.)",
  "Real Estate / Property Management",
  "Retail / Hospitality",
  "Technology / SaaS Companies",
  "Transportation / Logistics"
];

export const DELIVERY_MODEL_OPTIONS = [
  "Fully Managed IT Provider",
  "Co-Managed IT (internal IT support partnership)",
  "Project-Based IT Consulting",
  "Break-Fix / On-Demand Support",
  "Virtual CIO / Strategic Advisory"
];

export const PRICING_MODEL_OPTIONS = [
  "Per-user pricing",
  "Per-device pricing",
  "Flat-rate monthly service packages",
  "Tiered service packages",
  "Hourly / Project-based billing",
  "Custom / Hybrid pricing models"
];

export const COMPANY_GOALS_OPTIONS = [
  "Increase recurring revenue",
  "Modernize marketing and brand image",
  "Improve client retention",
  "Expand into new markets or regions",
  "Add new service offerings",
  "Attract higher-value clients",
  "Reduce client churn",
  "Build thought leadership and authority"
];

export const BRAND_VOICE_OPTIONS = [
  "Professional and authoritative",
  "Friendly and approachable",
  "Technical and precise",
  "Conversational and casual",
  "Bold and confident"
];

export const CLIENT_ACQUISITION_OPTIONS = [
  "Referrals / Word of Mouth",
  "Google Search / SEO",
  "Paid Advertising (Google Ads, Facebook)",
  "Social Media / LinkedIn",
  "Networking / Events / Conferences",
  "Vendor or Partner Referrals",
  "Cold Outreach / Outbound Sales"
];

export const WEBSITE_OBJECTIVES_OPTIONS = [
  "Generate qualified leads",
  "Strengthen credibility and authority",
  "Educate and build trust",
  "Support the sales process",
  "Attract top talent / recruiting",
  "Showcase case studies and results"
];

export const BUSINESS_SIZE_OPTIONS = [
  "1–10 employees",
  "10–25 employees",
  "26–50 employees",
  "51–100 employees",
  "101–250 employees",
  "250+ employees"
];

export const CLIENT_PROBLEMS_OPTIONS = [
  "Frequent downtime or outages",
  "Security incidents or data loss",
  "Lack of IT strategy or planning",
  "Poor responsiveness from current provider",
  "Rising IT costs / budget unpredictability",
  "Compliance concerns (HIPAA, SOC 2, etc.)",
  "Outdated technology / infrastructure",
  "Staff productivity issues"
];

export const CLIENT_OUTCOMES_OPTIONS = [
  "Reliable systems and less downtime",
  "Stronger cybersecurity posture",
  "Predictable monthly costs",
  "Strategic IT planning and guidance",
  "Improved staff productivity",
  "Compliance confidence",
  "Faster response times"
];

export const DECISION_MAKERS_OPTIONS = [
  "Business Owner / CEO",
  "IT Manager / Director",
  "Office Manager / Operations Manager",
  "CFO / Finance Director",
  "Practice Manager (for healthcare/legal)",
  "Board of Directors / Partners"
];

export const PRIMARY_CTA_OPTIONS = [
  "Schedule a Consultation",
  "Request a Quote",
  "Call Us Directly",
  "Get a Free Assessment",
  "Download a Resource / Guide"
];

export const QUESTIONS = [
  // Section: Additional Page Options
  {
    id: "1",
    section: "Additional Page Options",
    title: "Would you like to include a dedicated 'Why Choose Us' page on your website?",
    why: "This question determines whether your website will include a trust-building page focused entirely on your company's differentiators, strengths, and credibility markers.",
    guidance: "Select 'Yes' if you want a standalone page that highlights the reasons a prospective client should choose your MSP. Select 'No' if these elements should only appear in smaller modules on other pages.",
    type: "yes_no",
    conditionalChildren: [
      {
        id: "1.1",
        title: "Describe what sets your business apart from competitors.",
        why: "This description is used to create the core narrative of the Why Choose Us page.",
        guidance: "Provide a detailed explanation of your primary differentiators. These could include response-time guarantees, proprietary processes, team expertise, etc.",
        type: "textarea",
        requiredIfParentYes: true
      },
      {
        id: "1.2",
        title: "(Optional) List any awards, partnerships, certifications, or recognitions that reinforce your credibility.",
        why: "This information is used to build authority signals and trust indicators on the Why Choose Us page and homepage.",
        guidance: "List any major certifications, vendor partnerships, professional accreditations, or notable awards. You may leave this blank if you don't have any.",
        type: "textarea",
        requiredIfParentYes: false
      }
    ]
  },
  {
    id: "2",
    section: "Additional Page Options",
    title: "Would you like to include a 'Meet the Team' page on your website?",
    why: "This question determines whether your website will feature a team-focused page to humanize your company and build trust with prospects.",
    guidance: "Select 'Yes' if you want a dedicated page showcasing your team. Select 'No' if you prefer not to feature team members individually.",
    type: "yes_no",
    conditionalChildren: [
      {
        id: "2.1",
        title: "Provide an overview introduction for your team.",
        why: "This introduction forms the opening paragraph of your Meet the Team page.",
        guidance: "Write two to five sentences describing your team as a whole. Mention tenure, diversity of expertise, leadership philosophy, or internal culture.",
        type: "textarea",
        requiredIfParentYes: true
      },
      {
        id: "2.2",
        title: "Upload a team photo.",
        why: "A high-quality team photo adds authenticity and is a centerpiece of the Meet the Team page.",
        guidance: "Upload the highest-quality version available of your team photo. Accepted formats: JPG, JPEG, PNG.",
        type: "file_upload",
        requiredIfParentYes: true
      },
      {
        id: "2.3",
        title: "List each person in the photo along with their name, title, and a short description.",
        why: "These details allow the system to create clean, structured bio sections for each team member.",
        guidance: "List each person in order from left to right (and front to back if applicable). Provide their full name, role or title, and a one- to two-sentence description.",
        type: "textarea",
        requiredIfParentYes: true
      }
    ]
  },
  // Section: About Your Business
  {
    id: "3",
    section: "About Your Business",
    title: "How would you describe your company in one or two sentences?",
    why: "This concise description informs the top-level messaging for the homepage hero section, About page introduction, and metadata language.",
    guidance: "Provide a short summary that clearly states what your company does and who you serve. Focus on your specialization, geographic focus, or core differentiators.",
    type: "textarea"
  },
  {
    id: "4",
    section: "About Your Business",
    title: "What specific IT services and solutions do you provide?",
    why: "Your service selections directly determine which service pages are generated, how your navigation is structured, and which SEO opportunities are prioritized.",
    guidance: "Select the core services that represent your active offerings. You must choose between 3 and 10 items. The combined total with Industries (Q5) and Regions (Q6) must fall between 8 and 15.",
    type: "checkbox",
    options: SERVICE_OPTIONS,
    showOther: true,
    limits: { min: 3, max: 10 },
    isSpanQuestion: true
  },
  {
    id: "5",
    section: "About Your Business",
    title: "What industries do you specialize in supporting?",
    why: "Industry selection determines the Industry pages generated and helps us tailor messaging to the unique challenges of your target verticals.",
    guidance: "Select the industries where you have real experience or strategic intention. Minimum of 1 and maximum of 5 selections. Combined total with Q4 and Q6 must be between 8 and 15.",
    type: "checkbox",
    options: INDUSTRY_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 5 },
    isSpanQuestion: true
  },
  {
    id: "6",
    section: "About Your Business",
    title: "What markets or regions do you primarily serve?",
    why: "Your geographic focus determines whether we generate location-specific SEO pages and how local or national your messaging should be.",
    guidance: "Enter 1 to 5 locations that accurately represent your service area. These can be metropolitan areas, regions, multi-state areas, or national coverage.",
    type: "multi_text",
    limits: { min: 1, max: 5 },
    isSpanQuestion: true
  },
  {
    id: "7",
    section: "About Your Business",
    title: "How do you typically deliver your services?",
    why: "Your delivery model determines your service positioning and how we write your offer structure.",
    guidance: "Select all delivery models that accurately describe how clients engage with your MSP. Choose based on what you actively sell.",
    type: "checkbox",
    options: DELIVERY_MODEL_OPTIONS
  },
  {
    id: "8",
    section: "About Your Business",
    title: "What best describes your pricing or engagement model?",
    why: "Pricing structure is a major trust indicator for prospects and helps us frame expectations when writing the Pricing, Services, and CTA sections.",
    guidance: "Select all pricing models you actively use. Select the models that reflect your current and intended engagement structure.",
    type: "checkbox",
    options: PRICING_MODEL_OPTIONS
  },
  {
    id: "9",
    section: "About Your Business",
    title: "What makes your MSP different from others in your area?",
    why: "This is the foundation of your competitive positioning and is used on multiple pages: Home, About, Why Choose Us, and service pages.",
    guidance: "Describe the key differentiators that your ideal client would care about most. Be specific—avoid generic statements like 'we care more.'",
    type: "textarea"
  },
  {
    id: "10",
    section: "About Your Business",
    title: "What are your company's top goals for the next 12–18 months?",
    why: "Your goals shape your site's tone and focus. This directly influences CTA strategy and strategic content placement.",
    guidance: "Select up to three goals that represent your highest business priorities.",
    type: "checkbox",
    options: COMPANY_GOALS_OPTIONS,
    limits: { max: 3 }
  },
  {
    id: "11",
    section: "About Your Business",
    title: "How would you describe your brand voice?",
    why: "Brand voice determines tone, writing style, and how we present your MSP's personality.",
    guidance: "Choose the voice that best aligns with how you want prospects to perceive you.",
    type: "radio",
    options: BRAND_VOICE_OPTIONS
  },
  {
    id: "12",
    section: "About Your Business",
    title: "What certifications, awards, or partnerships should we highlight?",
    why: "Certifications and partnerships significantly increase perceived trust, especially in industries like healthcare, finance, and legal.",
    guidance: "List any certifications or awards you want displayed on your site. Include vendor partnerships, security certifications, or business awards.",
    type: "textarea"
  },
  {
    id: "13",
    section: "About Your Business",
    title: "What does your sales or onboarding process look like?",
    why: "This allows us to construct a clear, client-friendly process section that explains exactly how prospects move from consultation to onboarding.",
    guidance: "Describe the workflow a client experiences—typically 3–5 steps. Examples include consultation, assessment, proposal, onboarding, and ongoing support.",
    type: "textarea"
  },
  {
    id: "14",
    section: "About Your Business",
    title: "Do you have a specific guarantee or service standard?",
    why: "Guarantees help differentiate your MSP and reduce buyer friction. They function as high-impact trust elements.",
    guidance: "If you offer response-time guarantees, uptime commitments, contract flexibility, or satisfaction guarantees, list them here.",
    type: "textarea"
  },
  {
    id: "15",
    section: "About Your Business",
    title: "How do clients usually find you?",
    why: "This informs your website's funnel and helps emphasize the channels that already work.",
    guidance: "Select all acquisition channels that consistently produce leads. Avoid selecting channels you plan to explore later but do not use today.",
    type: "checkbox",
    options: CLIENT_ACQUISITION_OPTIONS
  },
  {
    id: "16",
    section: "About Your Business",
    title: "What do you want your website to achieve most?",
    why: "The primary business objective you select helps shape the homepage strategy, CTA placement, and content emphasis.",
    guidance: "Select up to three objectives that reflect your highest priorities.",
    type: "checkbox",
    options: WEBSITE_OBJECTIVES_OPTIONS,
    limits: { max: 3 }
  },
  // Section: About Your Target Clients
  {
    id: "17",
    section: "About Your Target Clients",
    title: "What types of clients do you serve best?",
    why: "This defines your Ideal Customer Profile (ICP) and helps us create targeted messaging across your homepage, industry pages, and service descriptions.",
    guidance: "Describe the characteristics of your ideal client—size, industry, IT maturity, compliance needs, or business style. Be specific and descriptive.",
    type: "textarea"
  },
  {
    id: "18",
    section: "About Your Target Clients",
    title: "What size businesses do you primarily support?",
    why: "Company size influences complexity, budget expectations, growth trajectory, and the scale of IT support required.",
    guidance: "Select all business size ranges that represent the majority of your client base.",
    type: "checkbox",
    options: BUSINESS_SIZE_OPTIONS
  },
  {
    id: "19",
    section: "About Your Target Clients",
    title: "What common problems do clients experience before hiring you?",
    why: "This question identifies your prospects' pain points, which helps create a strong connection with visitors.",
    guidance: "Select the top recurring problems clients share when they first contact you. Select up to 3.",
    type: "checkbox",
    options: CLIENT_PROBLEMS_OPTIONS,
    limits: { max: 3 }
  },
  {
    id: "20",
    section: "About Your Target Clients",
    title: "What are the biggest frustrations your clients express?",
    why: "Understanding client frustrations helps create empathetic messaging that connects emotionally with prospects.",
    guidance: "Write the common frustrations prospects share during sales calls or onboarding. Provide real language whenever possible.",
    type: "textarea"
  },
  {
    id: "21",
    section: "About Your Target Clients",
    title: "What results or outcomes do your clients want most?",
    why: "Identifying desired outcomes helps us focus your value propositions around measurable wins and aspirational benefits.",
    guidance: "Select up to 3 outcomes that reflect what your clients most commonly want from IT support.",
    type: "checkbox",
    options: CLIENT_OUTCOMES_OPTIONS,
    limits: { max: 3 }
  },
  {
    id: "22",
    section: "About Your Target Clients",
    title: "Who usually makes the buying decision?",
    why: "Understanding the primary decision makers ensures we tailor the messaging, CTAs, and content structure to their needs.",
    guidance: "Choose the roles or titles typically involved in signing agreements or approving MSP services.",
    type: "checkbox",
    options: DECISION_MAKERS_OPTIONS
  },
  {
    id: "23",
    section: "About Your Target Clients",
    title: "What words or phrases do clients typically use to describe your value?",
    why: "This question provides real client language that can shape testimonials, trust-building statements, and tone.",
    guidance: "List actual phrases you've heard from satisfied clients. Provide direct quotes if possible.",
    type: "textarea"
  },
  {
    id: "24",
    section: "About Your Target Clients",
    title: "Describe your ideal client in one or two sentences.",
    why: "This distills your ICP into a short statement that shapes your overall brand targeting strategy.",
    guidance: "Summarize the key traits of your ideal client—include their industry, size, IT maturity, personality traits, or business needs.",
    type: "textarea"
  },
  {
    id: "25",
    section: "About Your Target Clients",
    title: "Are there any industries or client types you prefer to avoid?",
    why: "This helps ensure your site does not attract leads that are unprofitable, high-risk, or outside your desired service areas.",
    guidance: "List any industries, business sizes, or client patterns that you prefer not to target.",
    type: "textarea"
  },
  {
    id: "26",
    section: "About Your Target Clients",
    title: "What is the #1 action you want website visitors to take?",
    why: "Identifying the primary CTA ensures that your site design supports your core business goal.",
    guidance: "Select the most important action for new visitors. Only choose one primary objective.",
    type: "radio",
    options: PRIMARY_CTA_OPTIONS
  },
  {
    id: "27",
    section: "About Your Target Clients",
    title: "Is there anything else we should know before building your website or writing your copy?",
    why: "This final question captures details that may not fit neatly into other categories.",
    guidance: "Share any additional context, requirements, preferences, or business nuances you want reflected in the project.",
    type: "textarea"
  }
];