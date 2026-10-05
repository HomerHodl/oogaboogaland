(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { clamp, lerp } = BL.math;
  const PHASES = ["dawn", "morning", "noon", "dusk", "night", "midnight"];
  const PHASE_STARTS = [5, 7, 11, 16, 19, 23];
  const ISLAND_LATITUDE_DEG = 20;
  const AXIAL_TILT_DEG = 23.44;
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const YEAR_DAYS = 365.2422;
  const SIDEREAL_RATE = 1.00273790935;
  const NIGHT_CLEAR = [0.08, 0.10, 0.18];
  const NIGHT_HORIZON = [0.18, 0.21, 0.37];
  const NIGHT_ZENITH = [0.07, 0.09, 0.18];
  // Backdrop stays dark, but hemispheric fill is lifted so silhouettes keep readable faces.
  const NIGHT_SKY = [0.33, 0.37, 0.50];
  const NIGHT_GROUND = [0.27, 0.28, 0.35];
  const NIGHT_SUN = [0.22, 0.26, 0.40];
  // The sun is the key light and the sky a cooler fill under it, so lit and shaded faces read apart.
  const DAY_CLEAR = [0.36, 0.58, 0.88];
  const DAY_HORIZON = [0.66, 0.82, 0.97];
  const DAY_ZENITH = [0.18, 0.44, 0.90];
  const DAY_SKY = [0.44, 0.52, 0.68];
  const DAY_GROUND = [0.30, 0.27, 0.21];
  const DAY_SUN = [0.74, 0.64, 0.50];
  const TWILIGHT_CLEAR = [0.34, 0.25, 0.42];
  const TWILIGHT_HORIZON = [1.00, 0.53, 0.25];
  const TWILIGHT_ZENITH = [0.18, 0.20, 0.48];
  const TWILIGHT_SKY = [0.53, 0.48, 0.62];
  const TWILIGHT_GROUND = [0.32, 0.28, 0.31];
  const TWILIGHT_SUN = [0.78, 0.42, 0.23];
  const MOON_LIGHT = [0.32, 0.37, 0.54];
  const SCRATCH_SUN = { x: 0, y: 1, z: 0 };
  const SCRATCH_DIRECT = new Float32Array(3);

  const phaseAt = (hour) => {
    let phase = PHASES[5];
    for (let i = 0; i < 6; i++) if (hour >= PHASE_STARTS[i]) phase = PHASES[i];
    return phase;
  };
  const smooth = (a, b, value) => {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const wrap = (value, period) => (value % period + period) % period;
  const mix3 = (out, a, b, t) => {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
  };
  const tint3 = (out, color, amount) => {
    out[0] = lerp(out[0], color[0], amount);
    out[1] = lerp(out[1], color[1], amount);
    out[2] = lerp(out[2], color[2], amount);
  };
  // Equatorial declination/hour angle -> east, up, south. The gate is north (-Z).
  const horizonDirection = (out, declination, hourAngle, latitude) => {
    const cd = Math.cos(declination), sd = Math.sin(declination);
    const ch = Math.cos(hourAngle), sh = Math.sin(hourAngle);
    const cp = Math.cos(latitude), sp = Math.sin(latitude);
    out.x = -cd * sh;
    out.y = sp * sd + cp * cd * ch;
    out.z = sp * cd * ch - cp * sd;
  };
  const sunAngles = (direction, out) => {
    out.sunAltitude = Math.asin(clamp(direction.y, -1, 1)) * RAD;
    out.sunAzimuth = wrap(Math.atan2(direction.x, -direction.z) * RAD, 360);
  };
  const moonAngles = (direction, out) => {
    out.moonAltitude = Math.asin(clamp(direction.y, -1, 1)) * RAD;
    out.moonAzimuth = wrap(Math.atan2(direction.x, -direction.z) * RAD, 360);
  };
  const starFrame = (out, latitude, sidereal) => {
    if (!out) return;
    const st = Math.sin(sidereal), ct = Math.cos(sidereal), sp = Math.sin(latitude), cp = Math.cos(latitude);
    // Column-major world east/up/south -> fixed equatorial coordinates.
    out[0] = -st; out[1] = ct; out[2] = 0;
    out[3] = cp * ct; out[4] = cp * st; out[5] = sp;
    out[6] = sp * ct; out[7] = sp * st; out[8] = -cp;
  };
  // Low-precision lunar elements and the principal solar perturbations, at UTC days since 2000 Jan 0.
  // Paul Schlyter, Computing planetary positions, sections 5-9.
  const realMoon = (utcMs, latitude, hour, out) => {
    const d = utcMs / 86400000 - 10956;
    const sunPerihelion = (282.9404 + 4.70935e-5 * d) * DEG;
    const sunAnomaly = wrap((356.0470 + 0.9856002585 * d) * DEG, TAU);
    const sunEccentricity = 0.016709 - 1.151e-9 * d;
    const sunE = sunAnomaly + sunEccentricity * Math.sin(sunAnomaly) * (1 + sunEccentricity * Math.cos(sunAnomaly));
    const sunLongitude = Math.atan2(Math.sqrt(1 - sunEccentricity ** 2) * Math.sin(sunE), Math.cos(sunE) - sunEccentricity) + sunPerihelion;
    const sunMeanLongitude = sunPerihelion + sunAnomaly;
    const node = wrap((125.1228 - 0.0529538083 * d) * DEG, TAU);
    const perigee = wrap((318.0634 + 0.1643573223 * d) * DEG, TAU);
    const anomaly = wrap((115.3654 + 13.0649929509 * d) * DEG, TAU);
    const eccentricity = 0.0549;
    let E = anomaly + eccentricity * Math.sin(anomaly) * (1 + eccentricity * Math.cos(anomaly));
    E -= (E - eccentricity * Math.sin(E) - anomaly) / (1 - eccentricity * Math.cos(E));
    const orbitX = 60.2666 * (Math.cos(E) - eccentricity);
    const orbitY = 60.2666 * Math.sqrt(1 - eccentricity ** 2) * Math.sin(E);
    const argument = Math.atan2(orbitY, orbitX) + perigee;
    const radius = Math.hypot(orbitX, orbitY);
    const cosNode = Math.cos(node), sinNode = Math.sin(node), cosArg = Math.cos(argument), sinArg = Math.sin(argument);
    const eclipticX = radius * (cosNode * cosArg - sinNode * sinArg * Math.cos(5.1454 * DEG));
    const eclipticY = radius * (sinNode * cosArg + cosNode * sinArg * Math.cos(5.1454 * DEG));
    const eclipticZ = radius * sinArg * Math.sin(5.1454 * DEG);
    const meanLongitude = node + perigee + anomaly;
    const elongation = meanLongitude - sunMeanLongitude;
    const argumentLatitude = meanLongitude - node;
    let moonLongitude = Math.atan2(eclipticY, eclipticX);
    let moonLatitude = Math.atan2(eclipticZ, Math.hypot(eclipticX, eclipticY));
    moonLongitude += DEG * (-1.274 * Math.sin(anomaly - 2 * elongation) + 0.658 * Math.sin(2 * elongation)
      - 0.186 * Math.sin(sunAnomaly) - 0.059 * Math.sin(2 * anomaly - 2 * elongation)
      - 0.057 * Math.sin(anomaly - 2 * elongation + sunAnomaly) + 0.053 * Math.sin(anomaly + 2 * elongation)
      + 0.046 * Math.sin(2 * elongation - sunAnomaly) + 0.041 * Math.sin(anomaly - sunAnomaly)
      - 0.035 * Math.sin(elongation) - 0.031 * Math.sin(anomaly + sunAnomaly)
      - 0.015 * Math.sin(2 * argumentLatitude - 2 * elongation) + 0.011 * Math.sin(anomaly - 4 * elongation));
    moonLatitude += DEG * (-0.173 * Math.sin(argumentLatitude - 2 * elongation)
      - 0.055 * Math.sin(anomaly - argumentLatitude - 2 * elongation)
      - 0.046 * Math.sin(anomaly + argumentLatitude - 2 * elongation)
      + 0.033 * Math.sin(argumentLatitude + 2 * elongation)
      + 0.017 * Math.sin(2 * anomaly + argumentLatitude));
    const distance = radius - 0.58 * Math.cos(anomaly - 2 * elongation) - 0.46 * Math.cos(2 * elongation);
    const obliquity = (23.4393 - 3.563e-7 * d) * DEG;
    const sinLon = Math.sin(moonLongitude), cosLon = Math.cos(moonLongitude), sinLat = Math.sin(moonLatitude), cosLat = Math.cos(moonLatitude);
    const moonY = sinLon * cosLat * Math.cos(obliquity) - sinLat * Math.sin(obliquity);
    const moonZ = sinLon * cosLat * Math.sin(obliquity) + sinLat * Math.cos(obliquity);
    const moonRA = Math.atan2(moonY, cosLon * cosLat);
    const moonDeclination = Math.asin(clamp(moonZ, -1, 1));
    // Like the sun above, use the island's clock: solar noon is on the meridian.
    const sunRA = Math.atan2(Math.sin(sunLongitude) * Math.cos(obliquity), Math.cos(sunLongitude));
    const sidereal = wrap(sunRA + (hour - 12) * 15 * DEG, TAU);
    horizonDirection(out.moon, moonDeclination, sidereal - moonRA, latitude);
    const altitude = Math.asin(clamp(out.moon.y, -1, 1));
    const topocentricAltitude = altitude - Math.asin(1 / distance) * Math.cos(altitude);
    const horizontal = Math.hypot(out.moon.x, out.moon.z);
    const scale = Math.cos(topocentricAltitude) / Math.max(horizontal, 1e-8);
    out.moon.x *= scale; out.moon.y = Math.sin(topocentricAltitude); out.moon.z *= scale;
    const sunDeclination = Math.asin(Math.sin(sunLongitude) * Math.sin(obliquity));
    if (out.moonSun) horizonDirection(out.moonSun, sunDeclination, sidereal - sunRA, latitude);
    out.moonIllumination = (1 - Math.cos(moonLongitude - sunLongitude) * Math.cos(moonLatitude)) * 0.5;
    out.moonPhase = wrap(moonLongitude - sunLongitude, TAU) / TAU;
    moonAngles(out.moon, out);
    return sidereal;
  };
  const sample = (hour, out, dayOfYear = 172, latitudeDeg = ISLAND_LATITUDE_DEG, continuousDay = NaN, utcMs = NaN) => {
    latitudeDeg = clamp(Number.isFinite(latitudeDeg) ? latitudeDeg : ISLAND_LATITUDE_DEG, -90, 90);
    dayOfYear = clamp(Number.isFinite(dayOfYear) ? dayOfYear : 172, 1, 366);
    if (!Number.isFinite(continuousDay)) continuousDay = dayOfYear - 1 + hour / 24;
    const latitude = latitudeDeg * DEG;
    const seasonalDay = wrap(continuousDay, YEAR_DAYS) + 1;
    const declination = AXIAL_TILT_DEG * DEG * Math.sin(TAU * (284 + seasonalDay) / YEAR_DAYS);
    const hourAngle = (hour - 12) * 15 * DEG;
    const sunDirection = out.sunDirection || SCRATCH_SUN;
    horizonDirection(sunDirection, declination, hourAngle, latitude);
    sunAngles(sunDirection, out);

    // Low-cost bounded lunar orbit: ecliptic longitude/latitude converted into equatorial space.
    let sidereal;
    if (Number.isFinite(utcMs)) sidereal = realMoon(utcMs, latitude, hour, out);
    else {
      const moonLongitude = wrap(TAU * (continuousDay - 4.867) / 27.321661, TAU);
      const moonLatitude = 5.145 * DEG * Math.sin(TAU * (continuousDay - 1.2) / 27.212221);
      const ce = Math.cos(AXIAL_TILT_DEG * DEG), se = Math.sin(AXIAL_TILT_DEG * DEG);
      const cl = Math.cos(moonLongitude), sl = Math.sin(moonLongitude), cb = Math.cos(moonLatitude), sb = Math.sin(moonLatitude);
      const ex = cb * cl, ey = cb * sl * ce - sb * se, ez = cb * sl * se + sb * ce;
      const moonDeclination = Math.asin(clamp(ez, -1, 1));
      const moonRightAscension = Math.atan2(ey, ex);
      sidereal = wrap(TAU * (0.7790572733 + continuousDay * SIDEREAL_RATE), TAU);
      horizonDirection(out.moon, moonDeclination, sidereal - moonRightAscension, latitude);
      moonAngles(out.moon, out);
      out.moonIllumination = 1;
      out.moonPhase = 0.5;
      if (out.moonSun) { out.moonSun.x = -out.moon.x; out.moonSun.y = -out.moon.y; out.moonSun.z = -out.moon.z; }
    }
    starFrame(out.starMatrix, latitude, sidereal);
    if (out.celestialPole) {
      out.celestialPole.x = 0;
      out.celestialPole.y = Math.sin(latitude);
      out.celestialPole.z = -Math.cos(latitude);
    }

    const altitude = out.sunAltitude;
    const daylight = smooth(-6, 8, altitude);
    const stars = 1 - smooth(-18, -6, altitude);
    const lamps = 1 - smooth(-6, 2, altitude);
    const twilight = smooth(-18, -3, altitude) * (1 - smooth(6, 18, altitude));
    mix3(out.clear, NIGHT_CLEAR, DAY_CLEAR, daylight);
    mix3(out.horizon, NIGHT_HORIZON, DAY_HORIZON, daylight);
    mix3(out.zenith, NIGHT_ZENITH, DAY_ZENITH, daylight);
    mix3(out.sky, NIGHT_SKY, DAY_SKY, daylight);
    mix3(out.ground, NIGHT_GROUND, DAY_GROUND, daylight);
    mix3(out.sun, NIGHT_SUN, DAY_SUN, daylight);
    tint3(out.clear, TWILIGHT_CLEAR, twilight * 0.42);
    tint3(out.horizon, TWILIGHT_HORIZON, twilight * 0.82);
    tint3(out.zenith, TWILIGHT_ZENITH, twilight * 0.48);
    tint3(out.sky, TWILIGHT_SKY, twilight * 0.42);
    tint3(out.ground, TWILIGHT_GROUND, twilight * 0.34);
    tint3(out.sun, TWILIGHT_SUN, twilight * 0.72);

    const sunStrength = smooth(0, 8, altitude);
    const moonStrength = stars * smooth(0, 10, out.moonAltitude) * 0.26 * out.moonIllumination;
    let lx = sunDirection.x * sunStrength + out.moon.x * moonStrength;
    let ly = sunDirection.y * sunStrength + out.moon.y * moonStrength;
    let lz = sunDirection.z * sunStrength + out.moon.z * moonStrength;
    let llen = Math.hypot(lx, ly, lz);
    if (llen < 1e-6) {
      lx = 0;
      ly = 1;
      lz = 0;
      llen = 1;
    }
    out.light.x = lx / llen;
    out.light.y = ly / llen;
    out.light.z = lz / llen;
    const totalStrength = clamp(sunStrength + moonStrength, 0, 1);
    const direct = out.direct || SCRATCH_DIRECT;
    const mixDenom = Math.max(sunStrength + moonStrength, 1e-6);
    const sunShare = sunStrength / mixDenom;
    direct[0] = lerp(MOON_LIGHT[0], out.sun[0], sunShare);
    direct[1] = lerp(MOON_LIGHT[1], out.sun[1], sunShare);
    direct[2] = lerp(MOON_LIGHT[2], out.sun[2], sunShare);
    const horizonCos = Math.max(0.08, Math.abs(out.light.y));
    const sunriseAngle = Math.acos(clamp(-Math.tan(latitude) * Math.tan(declination), -1, 1)) * RAD / 15;
    out.day = daylight;
    out.twilight = twilight;
    out.stars = stars;
    out.torch = lamps;
    out.lampFactor = lamps;
    out.bloomStrength = lerp(0.5, 0.9, stars) + twilight * 0.04;
    out.directStrength = totalStrength;
    out.directionalLightStrength = totalStrength;
    out.sunStrength = sunStrength;
    out.moonStrength = moonStrength;
    const nightFill = 1 - daylight;
    // Daytime shade keeps a floor of sky light, so a face turned from the sun still reads.
    out.ambientFloor = lerp(0.24, 0.27, nightFill);
    out.diffuseFloor = 0.10 * nightFill;
    out.shadowFloor = lerp(0.3, 0.38, nightFill);
    out.shadowStrength = clamp(sunStrength + moonStrength * 0.5, 0, 1);
    out.outdoorDarkestSurfaceEstimate = Math.max(out.ambientFloor, Math.min(out.sky[0], out.sky[1], out.sky[2], out.ground[0], out.ground[1], out.ground[2]));
    out.shadowBias = lerp(0.0012, 0.0038, 1 - horizonCos);
    out.activeLightSource = sunStrength > 0.02 && moonStrength > 0.02 ? "mixed" : sunStrength > 0.02 ? "sun" : moonStrength > 0.01 ? "moon" : "none";
    out.latitude = latitudeDeg;
    out.dayOfYear = dayOfYear;
    out.continuousDay = continuousDay;
    out.solarDeclination = declination * RAD;
    out.siderealAngle = sidereal;
    out.sunriseHour = 12 - sunriseAngle;
    out.sunsetHour = 12 + sunriseAngle;
    return out;
  };
  const localHour = (date) => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3600000;
  const localDay = (date) => Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const parseTime = (time) => {
    if (typeof time !== "string" || time.length !== 4 || !/^[0-2][0-9][0-5][0-9]$/.test(time)) return NaN;
    const hour = Number(time.slice(0, 2)), minute = Number(time.slice(2));
    return hour < 24 ? hour + minute / 60 : NaN;
  };
  const createClock = ({ hour, daylen, day, time, now = new Date() } = {}) => {
    const fixedHour = parseTime(time), fixed = Number.isFinite(fixedHour);
    const pinned = Number.isFinite(hour);
    const baseHour = fixed ? fixedHour : wrap(pinned ? hour : localHour(now), 24);
    const baseDay = clamp(Number.isFinite(day) ? Math.round(day) : localDay(now), 1, 366);
    const running = !fixed && (daylen > 0 || !pinned);
    const rate = daylen > 0 ? 24 / daylen : 1 / 3600;
    const start = performance.now();
    const baseMs = !fixed && !pinned && !Number.isFinite(day) ? now.getTime()
      : new Date(now.getFullYear(), 0, baseDay).getTime() + baseHour * 3600000;
    const state = { hour: baseHour, continuousDay: baseDay - 1 + baseHour / 24, dayOfYear: baseDay, utcMs: baseMs, read: null };
    state.read = () => {
      const elapsed = running ? (performance.now() - start) * 0.001 * rate : 0;
      const hours = baseHour + elapsed;
      state.hour = running ? wrap(hours, 24) : baseHour;
      state.continuousDay = baseDay - 1 + hours / 24;
      state.dayOfYear = Math.floor(wrap(state.continuousDay, 366)) + 1;
      state.utcMs = baseMs + elapsed * 3600000;
      return state.hour;
    };
    return state;
  };
  // A haze bank rings the island: above its 8-unit rim the apparent horizon drops, not any celestial direction.
  const hazeDropAt = (eyeHeight) => {
    const rise = Math.max(0, eyeHeight - 8);
    return rise / Math.hypot(110, rise);
  };
  BL.daylight = { PHASES, ISLAND_LATITUDE_DEG, AXIAL_TILT_DEG, phaseAt, sample, parseTime, createClock, hazeDropAt };
})();
