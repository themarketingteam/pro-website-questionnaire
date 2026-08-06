import { generatePDF } from '@/components/pro-form/PDFGenerator';

const longText = 'Synthetic managed-service description covering strategy, cybersecurity, cloud operations, responsive support, compliance planning, and measurable business outcomes. '.repeat(7);
const formData = {
  '1': 'yes', '1.1': longText, '2': 'yes', '2.1': ['Synthetic service page A', 'Synthetic service page B'],
  '3': ['Managed IT', 'Cybersecurity', 'Cloud Services'],
  '4': ['Healthcare / Medical', 'Financial Services', 'Professional Services'],
  '5': [{ label: 'Chicago, Illinois', primary: true }, { label: 'Montréal, Québec' }], '5_primary': 0,
  '6': longText, '7': 'Fully Managed IT Provider', '8': ['Per-user pricing', 'Fixed monthly fee'],
  '9': longText, '10': ['Increase recurring revenue', 'Improve client retention'], '11': 'Professional & Corporate',
  '12': 'yes', '12.1': [{ cert_item_name: 'SOC 2 Type II', cert_item_type: 'certification', cert_item_file_name: 'synthetic-soc2-summary.pdf' }],
  '13': longText, '14': 'yes', '14.1': [{ name: 'Response-time guarantee', guarantee_file_name: 'synthetic-guarantee.txt' }],
  '15': 'Referrals / Word of Mouth', '16': ['Generate qualified leads'], '17': '10-50 employees',
  '18': ['Frequent downtime or outages', 'Security and compliance concerns'], '19': longText,
  '20': ['Reliable systems and less downtime'], '21': 'Reliable, proactive, and easy to work with — café-ready support.',
  '22': longText, '23': 'yes', '23.1': 'Conditional synthetic retail and nonprofit audiences.',
  '24': 'Schedule a Consultation', '25': 'yes', '25.1': 'Synthetic final notes with Unicode: café, Montréal, résumé, ✓.',
};

document.getElementById('download').addEventListener('click', async () => {
  const result = await generatePDF(
    formData,
    'Synthetic Accessibility and PDF Quality Assurance Business Name With Extended Length',
    'synthetic-long-business-domain-for-pdf-quality-assurance.example.invalid',
    '2026-08-06T12:00:00.000Z',
  );
  document.getElementById('status').textContent = result.success ? 'PDF generated.' : 'PDF generation failed.';
});
