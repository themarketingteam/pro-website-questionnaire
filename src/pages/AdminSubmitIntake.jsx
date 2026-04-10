import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AdminSubmitIntake() {
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState(null);

  useEffect(() => {
    (async () => {
      const isAuthed = await base44.auth.isAuthenticated();
      setAuthed(isAuthed);
      if (isAuthed) {
        const me = await base44.auth.me();
        setUser(me);
      }
      setLoadingAuth(false);
    })();
  }, []);

  const payload = {
    metadata: {
      business_name: 'Strive Technology Consulting',
      businessDomain: 'striveit.com',
      submission_datetime: '2026-04-08T20:42:26.000Z',
      service_type: 'pro',
    },
    userdata: {
      additional_pages_list: {
        why_choose_us_page: {
          generate_page: true,
          why_choose_us_description:
            'Many organizations struggle to evaluate IT companies. From the outside, most of them look the same. At Strive Technology Consulting, the differences are easier to see:\n\nQuick Response\nThe single biggest complaint about the IT industry is slow response. We answer our phones live, and most issues are resolved within an hour of being reported.\n\nFriendly\nWe hire people who want to work with people as much as technology. Our team is selected for their friendly personality and trained in communication skills and emotional awareness. With us, you won’t get the stereotypical arrogant IT person talking over your head.\n\nProactive\nMost IT companies wait for you to call with a problem. Our entire approach is built around preventing problems before they disrupt your business.\n\nWe Speak Business\nAnyone can fix a computer. We take the time to understand your business, your goals, and your processes. Through regular strategic reviews and planning conversations, we help you make thoughtful decisions about technology and cybersecurity so they support the way your organization actually operates.',
        },
        meet_the_team_page: {
          generate_page: true,
          team_introduction:
            "The Strive team brings together a wide range of technical expertise, including network and systems administration, cybersecurity, programming and automation, web development, and deep experience supporting both Windows and Mac environments. Our engineers come from diverse technical backgrounds, but they share a common philosophy: technology should be reliable, well-planned, and explained in terms people can understand. The team is intentionally built to combine strong technical discipline with clear, respectful client relationships. The result is a group of professionals who take pride not only in solving complex technical problems, but in making technology easier for organizations to trust and depend on.",
          team_photo_with_tags: {
            taggedPeople: [
              {
                name: 'Tim Singleton',
                position: 'Founder, CEO',
                bio:
                  'Author, keynote speaker, and entrepreneur Tim Singleton began his career in IT in 1999. He quickly developed a reputation for being one of the best troubleshooters in the industry and was sought after by large and small IT companies alike. In 2006, he founded Strive Technology Consulting, an IT consulting firm working with companies that have a mission of making a positive impact on people\'s lives. Since then, he and his company have worked with everyone from sole proprietors to Fortune 50 companies providing expert and nuanced advice.\n\nTim has also developed a following in his side passion for human relations. After many years of studying human behavior and interpersonal dynamics, he began leading community organizations and teaching hundreds of people skills in emotional intelligence, communications, and personal relations. He now brings these skills to his staff at Strive, where the company has developed a reputation for its best-in-class technical offering, nuanced client relations, and high customer satisfaction.',
              },
            ],
          },
        },
      },
      service_offerings: [
        'Managed IT Services',
        'Cloud Solutions',
        'Modern Workplace & Productivity Solutions',
        'Cybersecurity Services',
        'FTC Compliance',
        'HIPAA Compliance',
        'IT Compliance',
        'PCI Compliance',
        'GRC Program Management',
        'Policy Documentation',
        'Network & Infrastructure Services',
        'Business Continuity Services',
        'Data Backup & Disaster Recovery Services',
        'Physical Security Solutions',
      ],
      service_offerings_other: 'Apple and Mac networks',
      target_industries: [
        'Dental Practices',
        'Financial / Accounting / CPA',
        'Government / Municipalities',
        'Healthcare / Medical',
        'Insurance Agencies',
        'Nonprofits / Education',
        'Technology / SaaS Companies',
      ],
      target_industries_other: 'Alternative Energy; Staffing and Employment',
      geographic_areas: [
        {
          geographic_area_meta: {
            name: 'Greater Boulder Area',
            label: 'Greater Boulder Area',
            source: 'google',
            primary: true,
          },
        },
        {
          geographic_area_meta: {
            name: 'Denver',
            label: 'Denver, CO, USA',
            source: 'google',
            primary: false,
          },
        },
      ],
      company_description:
        "Strive Technology Consulting helps organizations run their technology reliably and securely without having to manage it themselves.\n\nFor most small and mid-sized organizations, computers, networks, and cybersecurity are critical to daily operations, but managing them well requires time and specialized expertise. Strive provides a team that handles those responsibilities-supporting users when something goes wrong, monitoring systems to catch problems early, protecting against cybersecurity threats, and helping plan future technology decisions.\n\nWe primarily work with organizations in Colorado's Northern Front Range including healthcare practices, nonprofits, staffing companies, biotech firms, and other mission-driven organizations. These groups often need professional IT management and security but prefer to focus their internal time and energy on their core mission rather than running an IT department.",
      delivery_model: 'Fully Managed IT Provider',
      pricing_packaging: ['Custom / Hybrid pricing models'],
      pricing_packaging_other:
        'Flat-rate monthly plans that are customized to your company\'s needs',
      differentiation:
        "I want to highlight responsiveness. We answer our phones live, and most issues are resolved quickly after they are reported.\n\nOne thing that may not be obvious is that Strive was intentionally built around both technical discipline and human communication. Our approach is based on maintaining client environments against hundreds of documented technology standards and reviewing progress regularly through strategic planning conversations. These are executive-level conversations, not technical reviews, and customers often remark at how other IT companies claimed they were being proactive until they saw how we did proactive work, and they are shocked at the difference.\n\nAt the same time, our team is trained in communication and emotional intelligence so we can explain technology clearly and work with clients as partners and as humans. This level of human relations training is unique in our industry, and the opposite of the stereotype of anti-social IT people. That combination of strong process and strong human skills sets us apart in both delivery and customer experience.",
      company_goals: ['Increase recurring revenue'],
      brand_tone: 'Other',
      brand_tone_other:
        'Friendly & Approachable, but still very professional and trustworthy.',
      certifications_partnerships: [],
      sales_process:
        "1. Initial Consultation\nWe begin with a conversation to learn about your organization, why you're exploring a new IT partner, and any concerns about your current environment. This helps both sides determine whether Strive is a good fit.\n\n2. Understanding How We Work\nIf it looks like a good match, we schedule a second meeting to explain how Strive manages technology and what the ongoing relationship looks like, including support, maintenance, and long-term planning.\n\n3. A Different Approach to Assessment\nMany IT providers perform a diagnostic and present a roadmap based on what they find. These presentations can be compelling, but they are often designed to fit clients into a pre-built template.\n\nWe take a different approach. Our assessment includes hundreds of questions, and truly understanding your systems and workflows takes time. We don't believe it's possible to present a finished roadmap after two sales meetings.\n\n4. Real Alignment Over Time\nOver the first several months with us, we will review your systems, create documentation, and gradually align your technology so it supports your organization reliably, securely, and in a way that fits how you actually operate.",
      service_guarantee: true,
      service_guarantee_items: [
        {
          guarantee_name: '30-Day Guarantee',
          guarantee_type: 'guarantee',
          guarantee_description:
            "If you are not over-the-top thrilled with our support, customer service or problem-resolution by the end of the first 30 days, you can cancel your agreement and we'll refund 100% of your services fees, no questions asked. We'll also release you from any contract or project you hired us to deliver without penalties.",
        },
      ],
      client_acquisition: 'Referrals / Word of Mouth',
      website_objectives: [
        'Generate qualified leads',
        'Strengthen credibility and authority',
        'Educate and build trust',
      ],
      client_size: '20-80 employees',
      client_challenges: [
        'Lack of IT strategy or planning',
        'Poor responsiveness from current provider',
      ],
      client_challenges_other: 'Poor vCIO style guidance',
      client_frustrations:
        "Their IT company not calling them back for days at a time. Getting their problems fixed only to have the same problem happen again a week later. Having the IT guy assigned to their account get promoted, and the new guy they get is just not good enough. Feeling like they can rely on the IT company to keep the tech running, but they want the IT company to come to the client with strategy and proactive ideas about how to improve efficiency, but the client always has to initiate but doesn't really know what to ask for.",
      client_outcomes: [
        'Reliable systems and less downtime',
        'Strategic IT planning and guidance',
        'Faster response times',
      ],
      value_description:
        "Clients most often describe Strive as responsive, proactive, and easy to work with. They frequently mention fast response times, clear communication without technical jargon, and a team that treats people with respect rather than talking over their heads. Many also highlight the peace of mind that comes from having a proactive IT partner who prevents problems and helps their organization run more smoothly.\n\nSpecific words are: responsive, proactive, friendly, easy to understand, trustworthy, reliable, professional, and peace of mind.",
      ideal_client:
        'A company with 20-80 computer-using employees either located in the Denver/Boulder/Fort Collins corridor, or without a headquarters where all employees work from home from anywhere in the country. My ideal client is in the business of improving the world or people\'s lives; they know it and want an IT partner who appreciates their mission.',
      avoided_clients:
        "I prefer to avoid working with the oil and gas industry for personal moral and environmental reasons; that's just not an industry I want to make more efficient. Retail and hospitality (restaurants, hotels, etc.) tend to be a bad fit because they have few computers and their hours of operation when problems happen most frequently is outside our normal business hours. We prefer not to work with clients with fewer than 10 employees because the sophistication of our service is overkill for them, and the minimum cost to deliver our results is too high for them. Also, we want to avoid companies with a lot of employees but few computers, such as massage therapy companies.",
      primary_cta: 'Call Us Directly',
      additional_notes:
        'I would like to create a service page that discusses virtual companies that have no headquarters and all employees work from home. This is a particular strength of ours. We have east coast to west coast time zone coverage. We are in a number of professional industry groups from which we can create trusted partnerships for onsite work anywhere in the country. And managing a remote workforce poses logistical challenges that many IT companies haven\'t figured out yet, such as retrieving hardware after an employee leaves.',
    },
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const res = await base44.entities.ProFormSubmission.create(payload);
      setSubmittedId(res?.id || res?.data?.id || null);
      toast.success('Submission saved');
    } catch (e) {
      toast.error(e?.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-700">Please sign in to submit the intake payload.</p>
        <Button onClick={() => base44.auth.redirectToLogin(window.location.pathname)}>Sign in</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Admin Intake Submission</h1>
      <p className="text-sm text-slate-600">Signed in as {user?.email || 'user'}</p>

      <div className="p-4 bg-slate-50 border rounded overflow-auto max-h-72 text-xs">
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
          {submitting ? (<><Loader2 className="w-4 h-4 animate-spin"/> Submitting...</>) : 'Submit Now'}
        </Button>
        {submittedId && (
          <div className="flex items-center gap-1 text-green-700 text-sm">
            <CheckCircle2 className="w-4 h-4"/> Submitted (id: {submittedId})
          </div>
        )}
      </div>
    </div>
  );
}