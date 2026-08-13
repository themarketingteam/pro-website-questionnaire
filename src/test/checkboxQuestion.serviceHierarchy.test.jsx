import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CheckboxQuestion from '@/components/pro-form/CheckboxQuestion';

const groupedServices = {
  'Managed IT Services': ['Managed IT', 'Co-Managed IT'],
  'Cybersecurity Services': ['Managed Security Services']
};

const Harness = () => {
  const [value, setValue] = useState([]);

  return (
    <>
      <CheckboxQuestion
        options={Object.values(groupedServices).flat()}
        groupedOptions={groupedServices}
        value={value}
        onChange={setValue}
        min={3}
        max={15}
        allowCategorySelection={true}
      />
      <output data-testid="selection-state">{JSON.stringify(value)}</output>
    </>
  );
};

describe('CheckboxQuestion service hierarchy', () => {
  it('selects a parent without a modal and then unlocks selective children', () => {
    render(<Harness />);

    const parent = screen.getByRole('button', { name: 'Managed IT Services' });
    const managedIt = screen.getByRole('button', { name: 'Managed IT' });
    const coManaged = screen.getByRole('button', { name: 'Co-Managed IT' });

    expect(managedIt).toBeDisabled();
    expect(coManaged).toBeDisabled();
    expect(screen.queryByText('Category Selection')).not.toBeInTheDocument();

    fireEvent.click(parent);

    expect(managedIt).toBeEnabled();
    expect(coManaged).toBeEnabled();
    expect(screen.getByTestId('selection-state')).toHaveTextContent(
      '["PARENT:Managed IT Services"]'
    );
    expect(screen.getByText(/0 \/ 15 service selections/i)).toBeInTheDocument();
    expect(screen.getByText(/select at least one service under this parent page/i))
      .toBeInTheDocument();

    fireEvent.click(managedIt);

    expect(screen.getByTestId('selection-state')).toHaveTextContent(
      '["PARENT:Managed IT Services","Managed IT"]'
    );
    expect(screen.getByText(/1 \/ 15 service selections/i)).toBeInTheDocument();
    expect(coManaged).not.toBePressed();
    expect(screen.queryByText(/select at least one service under this parent page/i))
      .not.toBeInTheDocument();
  });

  it('clears all selected children when their parent is deselected', () => {
    render(<Harness />);

    const parent = screen.getByRole('button', { name: 'Managed IT Services' });
    const managedIt = screen.getByRole('button', { name: 'Managed IT' });

    fireEvent.click(parent);
    fireEvent.click(managedIt);
    fireEvent.click(parent);

    expect(screen.getByTestId('selection-state')).toHaveTextContent('[]');
    expect(managedIt).toBeDisabled();
  });

  it('allows a parent page to be selected at the service limit because parents do not count', () => {
    const AtLimitHarness = () => {
      const [value, setValue] = useState([
        'PARENT:Managed IT Services',
        'Managed IT'
      ]);

      return (
        <CheckboxQuestion
          options={Object.values(groupedServices).flat()}
          groupedOptions={groupedServices}
          value={value}
          onChange={setValue}
          min={1}
          max={1}
          allowCategorySelection={true}
          externalDisabled={true}
        />
      );
    };

    render(<AtLimitHarness />);

    const secondParent = screen.getByRole('button', { name: 'Cybersecurity Services' });
    expect(secondParent).toBeEnabled();
    fireEvent.click(secondParent);
    expect(secondParent).toBePressed();
    expect(screen.getByRole('button', { name: 'Managed Security Services' })).toBeDisabled();
  });
});
