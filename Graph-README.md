Assumptions:

- A data point is added every minute.
- The most recent point is always displayed despite the stride.
- Once the max display points + 1 is reached, multiply stride by 2, resample old points and add the most recent point. This results in (max display points / 2) + 1 points displayed.
- For the data below
    - New data point added every minute
    - Max display points = 256
    - Stride starts at 1 minute and is multiplied by two every reset

Hourly Data (1h to 24h):
Time         Points Collected        Factor       Points Displayed
  1h                60                  1                60
  2h               120                  1               120
  3h               180                  1               180
  4h               240                  1               240
  5h               300                  2               150
  6h               360                  2               180
  7h               420                  2               210
  8h               480                  2               240
  9h               540                  4               135
 10h               600                  4               150
 11h               660                  4               165
 12h               720                  4               180
 13h               780                  4               195
 14h               840                  4               210
 15h               900                  4               225
 16h               960                  4               240
 17h              1020                  4               255
 18h              1080                  8               135
 19h              1140                  8               143
 20h              1200                  8               150
 21h              1260                  8               158
 22h              1320                  8               165
 23h              1380                  8               173
 24h              1440                  8               180

Daily Data (1d to 20d):
Time         Points Collected        Factor       Points Displayed
  1d              1440                 8                180
  2d              2880                16                180
  3d              4320                32                135
  4d              5760                32                180
  5d              7200                32                225
  6d              8640                64                135
  7d             10080                64                158
  8d             11520                64                180
  9d             12960                64                203
 10d             14400                64                225
 11d             15840                64                248
 12d             17280               128                135
 13d             18720               128                147
 14d             20160               128                158
 15d             21600               128                169
 16d             23040               128                180
 17d             24480               128                192
 18d             25920               128                203
 19d             27360               128                214
 20d             28800               128                225


Formula 1: Downsampling Factor (Stride)

factor = max(1, 2^ceil(log2(n / MAX_POINTS))) 
Logic:
- n is the number of data points collected so far.
- MAX_POINTS is the maximum number of points allowed on the graph (e.g. 256).
- We want to reduce the number of points being drawn to stay under the limit.
- The stride (sampling factor) increases as needed in powers of 2: 1, 2, 4, 8, etc.
- The formula ensures we only increase the stride when absolutely necessary, by comparing how many total points we have (n) to how many we can afford to display (MAX_POINTS).


Formula 2: Number of Points Displayed

displayedPoints = floor((n - 1) / factor) + 1 
Logic:
- We treat the most recent data point separately: it's always shown, even if it doesn’t align with the stride.
- The remaining n - 1 points are downsampled by the current stride.
- We take every factorth point from the first n - 1, and then add one more point: the latest one.