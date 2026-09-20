"""Small independent fixtures for the proposal's denominator and missingness rules."""
import unittest
import pandas as pd
from prepare_data import COLUMNS, STRINGS, CAUSES, clean, measures, rates, MEASURES

class MetricTests(unittest.TestCase):
    def fixture(self):
        row={c:0 for c in COLUMNS}
        row.update({c:'X' for c in STRINGS})
        row.update(FlightDate='2025-01-01',Month=1,DayOfWeek=3,CRSDepTime=659,
                   CRSArrTime=900,Distance=100,Cancelled=0,Diverted=0)
        rows=[row.copy() for _ in range(5)]
        # One early arrival, one exactly 15 minutes late, cancellation, diversion,
        # and completed flight with unknown delay. Denominator must be two.
        for r,delay in zip(rows,[-1,15,None,60,None]):
            r['ArrDelay']=delay
            for c in CAUSES: r[c]=None
        rows[1].update({c:0 for c in CAUSES})
        rows[1]['CarrierDelay']=15
        rows[2]['Cancelled']=1
        rows[3]['Diverted']=1
        return pd.DataFrame(rows)

    def test_denominators_and_cause_missingness(self):
        df=clean(self.fixture())
        result=rates(measures(df)[MEASURES].sum().to_frame().T).iloc[0]
        self.assertEqual(result.scheduled_flights,5)
        self.assertEqual(result.eligible_arrivals,2)
        self.assertEqual(result.delayed_arrivals,1)
        self.assertEqual(result.arrival_delay_rate,0.5)
        self.assertEqual(result.cancellation_rate,0.2)
        self.assertEqual(result.diversion_rate,0.2)
        self.assertEqual(result.missing_arrival_delay,1)
        self.assertEqual(result.CarrierDelay_share,1)
        self.assertEqual(result.WeatherDelay_share,0)
        self.assertEqual(result.cause_complete_flights,1)
        self.assertTrue(pd.isna(df.loc[2,'ArrivalDelayed15']))
        self.assertTrue(pd.isna(df.loc[0,'CarrierDelay']))

    def test_midnight_and_invalid_clock(self):
        raw=self.fixture()
        raw['CRSDepTime']=[0,5,2400,1260,2359]
        hours=clean(raw).ScheduledDepHour
        self.assertEqual(hours.iloc[:3].tolist(),[0,0,0])
        self.assertTrue(pd.isna(hours.iloc[3]))
        self.assertEqual(hours.iloc[4],23)

    def test_no_denominator_and_no_cause_observations(self):
        df=clean(self.fixture().iloc[[2]])
        result=rates(measures(df)[MEASURES].sum().to_frame().T).iloc[0]
        self.assertTrue(pd.isna(result.arrival_delay_rate))
        self.assertTrue(pd.isna(result.CarrierDelay_minutes))
        self.assertTrue(pd.isna(result.CarrierDelay_share))
        self.assertEqual(result.CarrierDelay_observations,0)

if __name__=='__main__':
    unittest.main()
