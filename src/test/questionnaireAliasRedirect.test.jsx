import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import QuestionnaireAliasRedirect from '@/components/QuestionnaireAliasRedirect';

const credential = 'synthetic_alias_session_12345.abcdefghijklmnopqrstuvwxyzABCDEFGH';
function Destination() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const query = new URLSearchParams(location.search);
  const recovery = new URLSearchParams(location.hash.slice(1));
  return <>
    <output data-testid="destination">{JSON.stringify({ pathname: location.pathname, search: location.search, hash: location.hash,
      credential: recovery.get('draft'), businessName: query.get('businessName'), domain: query.get('domainName'), navigationType })}</output>
    <button onClick={() => navigate(-1)}>Back</button>
  </>;
}

describe('questionnaire alias recovery routing', () => {
  it.each(['/ProQuestionnaire', '/Home'])('preserves credentials and identity when %s redirects to the main questionnaire', async (alias) => {
    const search = '?businessName=Synthetic%20Client&domainName=example.test&userName=Example%20User';
    const hash = `#draft=${credential}&section=services`;
    render(<MemoryRouter initialEntries={['/earlier', `${alias}${search}${hash}`]} initialIndex={1}>
      <Routes>
        <Route path="/earlier" element={<p>Earlier page</p>} />
        <Route path={alias} element={<QuestionnaireAliasRedirect />} />
        <Route path="/" element={<Destination />} />
      </Routes>
    </MemoryRouter>);
    const destination = JSON.parse((await screen.findByTestId('destination')).textContent);
    expect(destination).toEqual({ pathname: '/', search, hash, credential, businessName: 'Synthetic Client', domain: 'example.test', navigationType: 'REPLACE' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Earlier page')).toBeInTheDocument();
  });
});
