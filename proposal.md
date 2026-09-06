# Delay Across the Network: An Interactive Visualization of U.S. Domestic Flight Reliability

**STATS 401 Final Project Proposal**  
**Group members:** Henghao Jiang, Linjin Di, Hanchi Zhao

## 1. Topic, Goals, and Questions

As one of the largest domestic aviation markets, if not the largest, the United States possesses the world's busiest airspace and air traffic. Due to a heavy reliance on air travel, U.S. airspace, route networks, and airports are operating at the limits of their capacity. This means that even minor operational errors can trigger widespread delays. We would like to examine domestic scheduled passenger flights reported to the U.S. Bureau of Transportation Statistics (BTS) during 2025. For travelers, aviation enthusiasts, and transportation students, coordinated views will support geographic exploration, temporal comparison, and interpretation of reported delay causes.

Our questions are:

1. Which airports have the highest delay and cancellation rates?
2. Which busy routes are comparatively reliable or unreliable?
3. How does reliability vary by month, weekday, and scheduled departure hour?
4. How do reported delay causes differ across airports, airlines, and seasons?
5. How is flight volume associated with reliability across airports and airlines?

## 2. Datasets

**Flight records.** We will download twelve monthly CSV archives from [BTS Reporting Carrier On-Time Performance](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=b0-gvzr&gnoyr_VQ=FGJ). We anticipate approximately 6–8 million records and will retain roughly 30 variables; exact counts will be confirmed after acquisition. Important [attributes](https://www.transtats.bts.gov/Fields.asp?gnoyr_VQ=FGJ) include flight date, reporting airline, origin/destination identifiers, scheduled times, departure/arrival delays, cancellation/diversion indicators, distance, and five delay-cause minute fields. Coverage is limited to reporting carriers rather than every U.S. flight.

**Airport metadata.** We will download the [BTS Master Coordinate](https://www.transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=N8vn6v10+f722146+gnoyr5&gnoyr_VQ=FLL) table, retaining approximately ten attributes and several hundred airports represented in our flight data. Key attributes are airport identifiers, names, cities, states, latitude, longitude, and validity dates. We will join origin and destination sequence identifiers to `AirportSeqID`, check uniqueness, and audit unmatched coordinates to prevent duplicated flight records.

Processing will preserve raw files, combine months, inspect duplicates, standardize types, distinguish missing values from zeros, and derive month, weekday, scheduled local departure hour, and directed routes. Weather integration and aircraft delay propagation remain optional extensions after the core dashboard works.

## 3. Analysis and Visualization Methods

Python will be used to clean and aggregate the data; TypeScript/JavaScript, HTML, CSS, and D3.js will implement the visualizations and interface. We will export compact CSV/JSON summaries retaining the dimensions needed for coordinated filters, partitioning by month when necessary.

Following the [BTS delay threshold](https://www.bts.gov/explore-topics-and-geography/topics/airline-time-performance-and-causes-flight-delays), arrival delay rate will measure arrivals at least 15 minutes late among noncancelled, nondiverted flights with valid arrival-delay data. Cancellation and diversion rates will use all scheduled records as denominators. Airport comparisons will default to outgoing flights and their arrival outcomes. Counts, denominators, and minimum-volume filters will accompany rates; pooled rates will be recomputed from counts.

Cause composition will use shares of reported attributed minutes, with missing values flagged. BTS categories describe reported attribution; `WeatherDelay` does not capture all weather effects because NAS can include weather. Comparisons will be descriptive, without causal claims.

Shared month/airline filters, airport selection, tooltips, and scatterplot brushing will support comparison, trend identification, relationship discovery, and outlier exploration. Selecting ORD will update its routes, temporal patterns, and cause composition; a reset restores the national overview.

## 4. Visualization Sketches

These sketches show proposed layouts, not measured results; colors and geographic detail will follow.

**1. Airport reliability — proportional-symbol geographic map.** Circle area encodes outgoing flight volume and color encodes delay or cancellation rate, revealing geographic differences for Question 1.
**2. Route reliability — directed node-link diagram.** For a selected origin, edge width encodes flight count and color encodes arrival-delay rate, identifying reliable and unreliable busy routes for Question 2.
**3. Temporal patterns — heatmap.** Weekday rows and scheduled departure-hour columns encode arrival-delay rate through color, with month selection enabling seasonal comparisons for Question 3.
**4. Delay causes — 100% stacked bar chart.** Colored segments represent shares of attributed delay minutes across five BTS categories, comparing selected airports or airlines for Question 4.
**5. Volume and reliability — scatterplot.** Flight count on the horizontal axis and arrival-delay rate on the vertical axis reveal associations and outliers for Question 5, with an airport/airline toggle and linked brushing.

## 5. Group Roles and Responsibilities

- **Henghao Jiang:** Data acquisition, cleaning, metric validation, temporal heatmap, and data documentation.
- **Linjin Di:** Geographic/network design, airport map, route diagram, and selection interactions.
- **Hanchi Zhao:** Cause chart, scatterplot, interface integration, and coordinated filtering.

All members will review work, test interactions and calculations, interpret findings, and prepare and deliver presentations. Weekly integration sessions will maintain shared understanding.

## 6. Interim Presentation Deliverables

We will demonstrate cleaned 2025 data, a quality summary, initial airport/airline/month comparisons, refined questions, and five sketches. A D3 prototype will connect the airport map and temporal heatmap through airport selection and a month filter. We will demonstrate exploration from national overview to airport detail, explain denominators, and identify remaining work.

## 7. Timeline and Milestones

- **Week 2 — Definition:** All members finalize questions, scope, and responsibilities; Henghao Jiang tests downloads, while Linjin Di/Hanchi Zhao sketch views. **Output:** proposal and data websites.
- **Week 3 — Preparation:** Henghao Jiang builds cleaning and aggregation; Linjin Di validates coordinates; Hanchi Zhao checks metrics. **Output:** cleaned data, quality report, and exploratory summaries.
- **Week 4 — Design:** Linjin Di implements the map; Henghao Jiang implements the heatmap; Hanchi Zhao builds shared filters. **Output:** refined sketches and connected prototype.
- **Week 5 — Interim:** All members validate and demonstrate the prototype; Linjin Di develops routes and Hanchi Zhao develops cause/scatter views. **Output:** interim presentation and five initial views.
- **Week 6 — Refinement:** Hanchi Zhao integrates views; Henghao Jiang checks filtered calculations; Linjin Di refines interactions. **Output:** complete dashboard with consistent legends, tooltips, and filters.
- **Week 7 — Delivery:** All members test usability and performance, polish documentation, and rehearse. **Output:** final website, reproducible repository, and presentation.
