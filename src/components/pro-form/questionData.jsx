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
  "Professional & Corporate",
  "Friendly & Approachable",
  "Technical & Expert-Driven",
  "Modern & Innovative",
  "Confident & Authoritative Expert",
  "High-End & Premium",
  "Story-Driven & Mission-Focused"
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
    why: "This question determines whether your website will include a trust-building page focused entirely on your company's differentiators, strengths, and credibility markers. The presence or absence of this page impacts your sitemap, navigation layout, and the structure of your homepage and About page messaging.",
    guidance: "Select 'Yes' if you want a standalone page that highlights the reasons a prospective client should choose your MSP over another. This page typically includes differentiators, methodologies, philosophies, guarantees, and proof points. Selecting 'No' means these elements will only appear in smaller modules on other pages instead of a dedicated page.",
    type: "yes_no",
    examples: { yes: "Yes, we want a Why Choose Us page.", no: "No, we do not want this page." },
    conditionalChildren: [
      {
        id: "1.1",
        title: "Describe what sets your business apart from competitors.",
        why: "This description is used to create the core narrative of the Why Choose Us page. It shapes the messaging tone, informs the lead-in hero section, and influences the proof-based elements that demonstrate why your MSP is the best choice.",
        guidance: "Provide a detailed explanation of your primary differentiators. These could include response-time guarantees, proprietary processes, team expertise, client service philosophy, onboarding methods, unique toolsets, or anything that meaningfully separates you from local competitors. Write in full sentences to help us shape compelling, high-converting content.",
        type: "textarea",
        requiredIfParentYes: true,
        examples: { shortAnswer: "We offer a 10-minute response guarantee, operate with a fully documented process library, and provide a dedicated vCIO to every client. Our approach emphasizes proactive security, transparent billing, and measurable outcomes." }
      },
      {
        id: "1.2",
        title: "(Optional) List any awards, partnerships, certifications, or recognitions that reinforce your credibility.",
        why: "This information is used to build authority signals and trust indicators on the Why Choose Us page and the homepage. Certifications and awards help increase conversions and improve perceived legitimacy.",
        guidance: "List any major certifications (Microsoft Partner, Cisco, AWS), vendor partnerships (Datto, Huntress, Duo), professional accreditations, security certifications, or notable awards. If you do not have any, you may leave this blank. If you do have some but are unsure which matter, list everything and our system will categorize and optimize automatically.",
        type: "textarea",
        requiredIfParentYes: false,
        examples: { shortAnswer: "Microsoft Partner, Datto Gold Partner, SonicWall SecureFirst, Cisco Certified Technician" }
      }
    ]
  },
  {
    id: "2",
    section: "Additional Page Options",
    title: "Would you like to include a 'Meet the Team' page on your website?",
    why: "This question determines whether your website will feature a team-focused page to humanize your company and build trust with prospects. A Meet the Team page can significantly improve conversions by showing the people behind the service.",
    guidance: "Select 'Yes' if you want a dedicated page showcasing your team, including staff roles, bios, and a team photo. This page is valuable for relationship-driven MSPs or companies targeting industries where personal trust is a major decision factor. Select 'No' if you prefer not to feature team members individually or do not have team imagery available.",
    type: "yes_no",
    examples: { yes: "Yes, we want a Meet the Team page.", no: "No, we do not want this page." },
    conditionalChildren: [
      {
        id: "2.1",
        title: "Provide an overview introduction for your team.",
        why: "This introduction forms the opening paragraph of your Meet the Team page and gives the visitor context about your team culture, values, structure, and strengths. A strong introduction significantly increases engagement and trust.",
        guidance: "Write two to five sentences describing your team as a whole. You can mention tenure, diversity of expertise, leadership philosophy, internal culture, or anything that reflects who you are as a team. Avoid listing individual bios here; the purpose is to introduce the group.",
        type: "textarea",
        requiredIfParentYes: true,
        examples: { shortAnswer: "Our team is composed of seasoned IT professionals with decades of combined experience. We emphasize proactive support, continuous improvement, and a collaborative culture that keeps clients confident and protected." }
      },
      {
        id: "2.2",
        title: "Upload a team photo.",
        why: "A high-quality team photo adds authenticity and is a centerpiece of the Meet the Team page. This element improves user trust and signals professionalism.",
        guidance: "Upload the highest-quality version available of your team photo. Accepted formats include .jpg, .jpeg, or .png. If you have multiple photos, upload the primary image you prefer to feature. Landscape orientation is typically best.",
        type: "file_upload",
        requiredIfParentYes: true,
        examples: { fileTypes: ["jpg", "jpeg", "png"], notes: "A single high-quality image is recommended." }
      },
      {
        id: "2.3",
        title: "List each person in the photo along with their name, title, and a short description.",
        why: "These details allow the system to create clean, structured bio sections for each team member. This improves both readability and SEO value.",
        guidance: "List each person in order from left to right (and front to back if applicable). For each team member, provide their full name, role or title, and a one- to two-sentence description of their expertise or responsibilities.",
        type: "textarea",
        requiredIfParentYes: true,
        examples: { shortAnswer: "Left to right: John Smith – CEO – 20+ years leading IT operations. Sarah Lee – Lead Engineer – Specialist in cloud migrations and cybersecurity. Mark Patel – Help Desk Manager – Known for rapid response times and customer care." }
      }
    ]
  },
  // Section: About Your Business
  {
    id: "3",
    section: "About Your Business",
    title: "How would you describe your company in one or two sentences?",
    why: "This concise description informs the top-level messaging for the homepage hero section, About page introduction, and metadata language. It helps establish your positioning and communicates your value in a high-level, client-friendly format.",
    guidance: "Provide a short summary that clearly states what your company does and who you serve. Focus on your specialization, geographic focus, or core differentiators. Avoid long lists or technical jargon—this should be polished, brand-ready language.",
    type: "textarea",
    examples: { shortAnswer: "We are a cybersecurity-driven Managed IT Provider supporting small and mid-sized professional firms throughout the Midwest." }
  },
  {
    id: "4",
    section: "About Your Business",
    title: "What specific IT services and solutions do you provide?",
    why: "Your service selections directly determine which service pages are generated, how your navigation is structured, and which SEO opportunities are prioritized. This ensures the site focuses on what you actually sell and positions you correctly in the market.",
    guidance: "Select the core services that represent your active offerings—not every service you've ever provided. Choose the areas where you have meaningful expertise or where you want to grow. You must choose between 3 and 10 items, and the combined total with Q5 and Q6 must fall between 8 and 15.",
    type: "checkbox",
    options: SERVICE_OPTIONS,
    showOther: true,
    limits: { min: 3, max: 10 },
    isSpanQuestion: true,
    examples: { selections: ["Managed IT Services / Help Desk", "Cybersecurity & Threat Protection", "Microsoft 365 / Cloud Management"], other: "IT Compliance Consulting (HIPAA, SOC 2)" }
  },
  {
    id: "5",
    section: "About Your Business",
    title: "What industries do you specialize in supporting?",
    why: "Industry selection determines the Industry pages generated and helps us tailor messaging to the unique challenges of your target verticals. Industry alignment is one of the strongest differentiators for MSPs and is often a major factor in lead quality.",
    guidance: "Select the industries where you have real experience or strategic intention. These should be industries you actively target or where you have case studies, strong knowledge, or repeat clients. Minimum of 1 and maximum of 5 selections. Total combined with Q4 and Q6 must be between 8 and 15.",
    type: "checkbox",
    options: INDUSTRY_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 5 },
    isSpanQuestion: true,
    examples: { selections: ["Healthcare / Medical", "Financial / Accounting / CPA", "Manufacturing / Construction"], other: "Real Estate and Property Management" }
  },
  {
    id: "6",
    section: "About Your Business",
    title: "What markets or regions do you primarily serve?",
    why: "Your geographic focus determines whether we generate location-specific SEO pages and how local or national your messaging should be. This affects local SEO, Google Business Profile optimization, and how we describe your service footprint throughout the site.",
    guidance: "Search and select 1 to 5 locations that accurately represent your service area. These can be metropolitan areas, regions, multi-state areas, or national coverage. Use the Google Places search to find and add locations. Combined total with Q4 and Q5 must be between 8 and 15.",
    type: "geographic",
    limits: { min: 1, max: 5 },
    isSpanQuestion: true,
    examples: { entries: ["Greater Nashville Area", "Middle Tennessee"] }
  },
  {
    id: "7",
    section: "About Your Business",
    title: "How do you typically deliver your services?",
    why: "Your delivery model determines your service positioning and how we write your offer structure. This influences pricing language, expectations, CTA blocks, and the way we describe your working relationship with clients.",
    guidance: "Select the primary delivery model that accurately describes how clients engage with your MSP. Choose based on what you actively sell—not models you used historically but no longer offer.",
    type: "radio",
    options: DELIVERY_MODEL_OPTIONS,
    showOther: true,
    examples: { selection: "Fully Managed IT Provider" }
  },
  {
    id: "8",
    section: "About Your Business",
    title: "What best describes your pricing or engagement model?",
    why: "Pricing structure is a major trust indicator for prospects and helps us frame expectations when writing the Pricing, Services, and CTA sections. It also guides the tone—whether you're positioned as premium, flexible, standardized, or customizable.",
    guidance: "Select all pricing models you actively use. For example, some MSPs offer flat-rate per-user pricing for managed clients but use hourly billing for special projects. Select the models that reflect your current and intended engagement structure.",
    type: "checkbox",
    options: PRICING_MODEL_OPTIONS,
    showOther: true,
    limits: { min: 1, max: 3 },
    examples: { selections: ["Per-user pricing", "Flat-rate monthly service packages"] }
  },
  {
    id: "9",
    section: "About Your Business",
    title: "What makes your MSP different from others in your area?",
    why: "This is the foundation of your competitive positioning and is used on multiple pages: Home, About, Why Choose Us (if selected), and several service pages. It also guides SEO value statements, trust blocks, and conversion-focused copy.",
    guidance: "Describe the key differentiators that your ideal client would care about most. Examples include rapid response times, process discipline, compliance expertise, cybersecurity maturity, unique onboarding workflows, or customer experience philosophies. Be specific—avoid generic statements like 'we care more.'",
    type: "textarea",
    examples: { shortAnswer: "We document every workflow, provide a 10-minute response guarantee, and offer a dedicated vCIO for strategic planning and quarterly reviews." }
  },
  {
    id: "10",
    section: "About Your Business",
    title: "What are your company's top goals for the next 12–18 months?",
    why: "Your goals shape your site's tone and focus. An MSP trying to build credibility needs different messaging than one focusing on scaling MRR or entering new verticals. This question directly influences CTA strategy and strategic content placement.",
    guidance: "Select up to three goals that represent your highest business priorities. These should reflect what you want your website and marketing to help you achieve. Avoid selecting every option—focus on what matters most.",
    type: "checkbox",
    options: COMPANY_GOALS_OPTIONS,
    showOther: true,
    limits: { max: 3 },
    examples: { selections: ["Increase recurring revenue", "Modernize marketing and brand image", "Improve client retention"] }
  },
  {
    id: "11",
    section: "About Your Business",
    title: "How would you describe your brand voice?",
    why: "Brand voice determines tone, writing style, and how we present your MSP's personality. The selected voice affects headlines, call-to-action language, and the way we frame your value throughout the site.",
    guidance: "Choose the voice that best aligns with how you want prospects to perceive you. If your company culture is casual and friendly, select a conversational voice. If you serve regulated industries, a more authoritative tone may be appropriate.",
    type: "radio",
    options: BRAND_VOICE_OPTIONS,
    examples: { selection: "Professional and authoritative" }
  },
  {
    id: "12",
    section: "About Your Business",
    title: "What certifications, awards, or partnerships should we highlight?",
    why: "Certifications and partnerships significantly increase perceived trust, especially in industries like healthcare, finance, and legal. They also support SEO by validating your expertise.",
    guidance: "List any certifications or awards you want displayed on your site. These may include vendor partnerships (Microsoft Partner, Datto Gold), security certifications (CompTIA Security+), or business awards. Include anything that reinforces expertise.",
    type: "textarea",
    examples: { shortAnswer: "Microsoft Partner, Datto Gold Partner, Cisco Meraki CMNA" }
  },
  {
    id: "13",
    section: "About Your Business",
    title: "What does your sales or onboarding process look like?",
    why: "This allows us to construct a clear, client-friendly process section that explains exactly how prospects move from consultation to onboarding. It increases transparency and helps build trust.",
    guidance: "Describe the workflow a client experiences—typically 3–5 steps. Examples include consultation, assessment, proposal, onboarding, and ongoing support. If your process includes guarantees or follow-ups, include those details as well.",
    type: "textarea",
    examples: { shortAnswer: "Discovery call → Network assessment → Proposal → Kickoff meeting → 30-day onboarding and optimization" }
  },
  {
    id: "14",
    section: "About Your Business",
    title: "Do you have a specific guarantee or service standard?",
    why: "Guarantees help differentiate your MSP and reduce buyer friction. They function as high-impact trust elements and often appear in hero sections, CTA blocks, and the Why Choose Us page.",
    guidance: "If you offer response-time guarantees, uptime commitments, contract flexibility, or satisfaction guarantees, list them here. If you have SLAs that define your standards, summarize the highlight points for clients.",
    type: "textarea",
    examples: { shortAnswer: "10-minute help desk response guarantee and no long-term contracts." }
  },
  {
    id: "15",
    section: "About Your Business",
    title: "How do clients usually find you?",
    why: "This informs your website's funnel and helps emphasize the channels that already work. If referrals are your top source, your messaging should highlight client experience. If SEO drives leads, we may strengthen educational or resource-focused content.",
    guidance: "Select the primary acquisition channel that consistently produces leads. Choose the channel that represents your main source of new business today.",
    type: "radio",
    options: CLIENT_ACQUISITION_OPTIONS,
    showOther: true,
    examples: { selection: "Referrals / Word of Mouth" }
  },
  {
    id: "16",
    section: "About Your Business",
    title: "What do you want your website to achieve most?",
    why: "The primary business objective you select helps shape the homepage strategy, CTA placement, and the emphasis of your content. Sites built for lead generation behave differently from sites built for authority or education.",
    guidance: "Select up to three objectives that reflect your highest priorities. If your top goal is lead-generation, CTAs will be more prominent. If your focus is credibility, we will emphasize proof elements such as case studies, certifications, and differentiators.",
    type: "checkbox",
    options: WEBSITE_OBJECTIVES_OPTIONS,
    showOther: true,
    limits: { max: 3 },
    examples: { selections: ["Generate qualified leads", "Strengthen credibility and authority", "Educate and build trust"] }
  },
  // Section: About Your Target Clients
  {
    id: "17",
    section: "About Your Target Clients",
    title: "What types of clients do you serve best?",
    why: "This defines your Ideal Customer Profile (ICP) and helps us create targeted messaging across your homepage, industry pages, and service descriptions. When we understand who you serve best, the voice and value proposition can be refined to attract and convert those clients.",
    guidance: "Describe the characteristics of your ideal client—size, industry, IT maturity, compliance needs, or business style. Focus on clients who are profitable, easy to support, and represent the majority of your best-fit opportunities. Avoid listing every possible client type. Be specific and descriptive.",
    type: "textarea",
    examples: { shortAnswer: "We serve regulated professional firms with 25–150 employees who prioritize security, compliance, and strategic long-term IT planning." }
  },
  {
    id: "18",
    section: "About Your Target Clients",
    title: "What size businesses do you primarily support?",
    why: "Company size influences complexity, budget expectations, growth trajectory, and the scale of IT support required. This data helps us adjust your messaging—from SMB-focused to mid-market or enterprise-support positioning.",
    guidance: "Specify the range of business sizes you primarily support. Enter the smallest and largest company sizes by number of employees.",
    type: "numeric_range",
    minValue: 1,
    maxValue: 50,
    examples: { shortAnswer: "10-100 employees" }
  },
  {
    id: "19",
    section: "About Your Target Clients",
    title: "What common problems do clients experience before hiring you?",
    why: "This question identifies your prospects' pain points, which helps create a strong connection with visitors by immediately addressing the issues they are actively facing. It impacts the Home page stakes section, service page intros, and trust-building copy.",
    guidance: "Select the top recurring problems clients share when they first contact you. Choose issues you can solve exceptionally well and that resonate with your ICP. Select up to 3. These will be used to frame your problem–solution narrative.",
    type: "checkbox",
    options: CLIENT_PROBLEMS_OPTIONS,
    showOther: true,
    limits: { max: 3 },
    examples: { selections: ["Frequent downtime or outages", "Security incidents or data loss", "Lack of IT strategy or planning"] }
  },
  {
    id: "20",
    section: "About Your Target Clients",
    title: "What are the biggest frustrations your clients express?",
    why: "Understanding client frustrations helps create empathetic messaging that connects emotionally with prospects. It improves the resonance of your brand voice and is used to position your MSP as the solution to their negative past experiences.",
    guidance: "Write the common frustrations prospects share during sales calls or onboarding. Examples include poor responsiveness from previous providers, confusing communication, lack of transparency, or reactive-only IT support. Provide real language whenever possible.",
    type: "textarea",
    examples: { shortAnswer: "Clients often tell us their previous MSP took days to respond, lacked a clear process, and provided little visibility into what was actually being done." }
  },
  {
    id: "21",
    section: "About Your Target Clients",
    title: "What results or outcomes do your clients want most?",
    why: "Identifying desired outcomes helps us focus your value propositions around measurable wins and aspirational benefits. These insights drive your benefit-focused messaging throughout the site, especially on your homepage and service pages.",
    guidance: "Select up to 3 outcomes that reflect what your clients most commonly want from IT support. These may include reliability, security, reduced downtime, predictable costs, or long-term strategy. Focus on the outcomes that align best with your strengths.",
    type: "checkbox",
    options: CLIENT_OUTCOMES_OPTIONS,
    showOther: true,
    limits: { max: 3 },
    examples: { selections: ["Reliable systems and less downtime", "Stronger cybersecurity posture", "Predictable monthly costs"] }
  },
  {
    id: "22",
    section: "About Your Target Clients",
    title: "Who usually makes the buying decision?",
    why: "Understanding the primary decision maker ensures we tailor the messaging, CTAs, and content structure to their needs and expectations. Different roles care about different aspects of IT (security, risk, budget, efficiency, staff support, etc.).",
    guidance: "Choose the primary role or title typically involved in signing agreements or approving MSP services. Select the main decision maker for your target clients.",
    type: "radio",
    options: DECISION_MAKERS_OPTIONS,
    showOther: true,
    examples: { selection: "Business Owner / CEO" }
  },
  {
    id: "23",
    section: "About Your Target Clients",
    title: "What words or phrases do clients typically use to describe your value?",
    why: "This question provides real client language that can shape testimonials, trust-building statements, and tone. Using your clients' own words significantly boosts authenticity and conversion rates.",
    guidance: "List actual phrases you've heard from satisfied clients—comments about reliability, responsiveness, friendliness, expertise, accountability, or peace of mind. Provide direct quotes if possible. These will be incorporated into voice-of-customer copy.",
    type: "textarea",
    examples: { shortAnswer: "Responsive, proactive, and easy to work with—clients often say they trust us because we communicate clearly and never leave them guessing." }
  },
  {
    id: "24",
    section: "About Your Target Clients",
    title: "Describe your ideal client in one or two sentences.",
    why: "This distills your ICP into a short statement that shapes your overall brand targeting strategy. It influences the site's tone, messaging, and which benefits are emphasized most prominently.",
    guidance: "Summarize the key traits of your ideal client—include their industry, size, IT maturity, personality traits, or business needs. This should be a clear and concise statement that reflects who you're trying to attract long-term.",
    type: "textarea",
    examples: { shortAnswer: "Our ideal clients are 25–100 employee professional firms who value proactive IT strategy, compliance support, and consistent partnership." }
  },
  {
    id: "25",
    section: "About Your Target Clients",
    title: "Are there any industries or client types you prefer to avoid?",
    why: "This helps ensure your site does not attract leads that are unprofitable, high-risk, or outside your desired service areas. It also helps refine SEO and prevent misalignment between marketing and operational reality.",
    guidance: "List any industries, business sizes, or client patterns that you prefer not to target. Be honest—if certain clients drain resources or don't align with your expertise, we use this information to avoid attracting them.",
    type: "textarea",
    examples: { shortAnswer: "We avoid restaurants, retail stores, and micro-businesses under 5 employees." }
  },
  {
    id: "26",
    section: "About Your Target Clients",
    title: "What is the #1 action you want website visitors to take?",
    why: "Identifying the primary CTA ensures that your site design supports your core business goal—whether it's generating consultations, quote requests, or direct calls. This affects button placement, top-level navigation, and funnel architecture.",
    guidance: "Select the most important action for new visitors. If you typically convert best through consultations, choose that. If your ICP prefers calling directly, choose a phone call CTA. Only choose one primary objective to maintain a clear and focused conversion path.",
    type: "radio",
    options: PRIMARY_CTA_OPTIONS,
    showOther: true,
    examples: { selection: "Schedule a Consultation" }
  },
  {
    id: "27",
    section: "About Your Target Clients",
    title: "Is there anything else we should know before building your website or writing your copy?",
    why: "This final question captures details that may not fit neatly into other categories—such as special requirements, unique offerings, website restrictions, brand elements, or internal goals.",
    guidance: "Share any additional context, requirements, preferences, or business nuances you want reflected in the project. If anything from your current website must be preserved or avoided, include that information here.",
    type: "textarea",
    examples: { shortAnswer: "Please avoid using stock photos that resemble call centers. We prefer actual team imagery whenever possible." }
  }
];