document.addEventListener('DOMContentLoaded', () => {
    // State variables
    let engineOn = false;
    let currentGear = 'N'; // N, 1, 2, 3, 4, 5, R
    let speed = 0;
    let rpm = 0;

    // Pedal states
    let gasPressed = false;
    let brakePressed = false;
    let clutchPressed = false;

    // --- AUDIO SYSTEM (Web Audio API) ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;
    let engineOsc = null;
    let engineGain = null;
    let crankInterval = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new AudioContext();

            // Main engine sound (low frequency sawtooth)
            engineOsc = audioCtx.createOscillator();
            engineOsc.type = 'sawtooth';
            engineOsc.frequency.value = 40; // Base idle freq

            // Add a sub-oscillator for more bass
            const subOsc = audioCtx.createOscillator();
            subOsc.type = 'square';
            subOsc.frequency.value = 20;

            engineGain = audioCtx.createGain();
            engineGain.gain.value = 0; // Muted initially

            // Simple lowpass filter to muffle the engine a bit
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 800;

            engineOsc.connect(filter);
            subOsc.connect(filter);
            filter.connect(engineGain);
            engineGain.connect(audioCtx.destination);

            engineOsc.start();
            subOsc.start();

            // Link oscillators so we can just update engineOsc
            engineOsc.sub = subOsc;
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    // Generic function to play a mechanical "click" or "clunk" sound
    function playMechanicalSound(type) {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;

        if (type === 'pedal_down') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'pedal_up') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(80, now);
            osc.frequency.exponentialRampToValueAtTime(120, now + 0.05);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'gear_shift') {
            // A metallic clunk
            osc.type = 'square';
            filter.type = 'bandpass';
            filter.frequency.value = 1000;
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === 'grind') {
            // Ugly noise
            osc.type = 'sawtooth';
            filter.type = 'highpass';
            filter.frequency.value = 2000;
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.linearRampToValueAtTime(600, now + 0.2);
            gain.gain.setValueAtTime(0.4, now);
            gain.gain.linearRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    }

    // Plays the repetitive "cranking" sound
    function playCrankSound() {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    }


    // Elements
    const keySlot = document.getElementById('key-slot');
    const carKey = document.getElementById('car-key');
    const engineStatusEl = document.getElementById('engine-status');
    const currentGearEl = document.getElementById('current-gear');
    const rpmValueEl = document.getElementById('rpm-value');
    const speedValueEl = document.getElementById('speed-value');
    const gearStick = document.getElementById('gear-stick');
    const gearSlots = document.querySelectorAll('.gear-slot');
    const steeringWheel = document.getElementById('steering-wheel');

    // Pedals
    const clutchEl = document.getElementById('clutch');
    const brakeEl = document.getElementById('brake');
    const gasEl = document.getElementById('gas');

    // --- IGNITION (HOLD TO START) ---
    let ignitionHeld = false;
    let ignitionProgress = 0; // How close to starting it is
    let currentStartDifficulty = Math.random() * 2 + 1; // Random seconds it takes to start (1 to 3s)

    function pressIgnition() {
        initAudio(); // Initialize audio on first user interaction
        if (engineOn) {
            // If running, turn off immediately
            engineOn = false;
            carKey.classList.remove('on');
            engineStatusEl.innerText = 'ENGINE: OFF';
            engineStatusEl.classList.remove('on');
            engineStatusEl.style.color = '';
            ignitionHeld = false;
            if (engineGain) engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        } else {
            // If off, start cranking
            ignitionHeld = true;
            carKey.classList.add('cranking'); // Create this class for visual feedback
            engineStatusEl.innerText = 'CRANKING...';
            engineStatusEl.style.color = '#ffaa00';
            // Start RPM flutter to simulate starter motor
            rpm = 300;
            if (engineGain) engineGain.gain.setValueAtTime(0, audioCtx.currentTime); // keep main engine quiet
            playCrankSound();
            crankInterval = setInterval(playCrankSound, 200);
        }
    }

    function releaseIgnition() {
        if (!engineOn) {
            ignitionHeld = false;
            carKey.classList.remove('cranking');
            clearInterval(crankInterval);
            if (ignitionProgress < currentStartDifficulty) {
                // Failed to start
                ignitionProgress = 0;
                engineStatusEl.innerText = 'ENGINE: OFF';
                engineStatusEl.style.color = '';
                // Generate new difficulty for next try
                currentStartDifficulty = Math.random() * 2 + 1;
            }
        }
    }

    keySlot.addEventListener('mousedown', pressIgnition);
    keySlot.addEventListener('touchstart', (e) => { e.preventDefault(); pressIgnition(); }, { passive: false });
    document.addEventListener('mouseup', releaseIgnition);
    document.addEventListener('touchend', releaseIgnition);

    // --- GEARBOX ---
    gearSlots.forEach(slot => {
        slot.addEventListener('click', () => {
            const selectedGear = slot.getAttribute('data-gear');

            // Allow shifting if (clutch is pressed OR engine is off) or if shifting to Neutral
            if (clutchPressed || !engineOn || selectedGear === currentGear) {
                // If clicking the currently selected gear, shift to Neutral
                if (currentGear === selectedGear) {
                    currentGear = 'N';
                    updateGearStickPos('N');
                } else {
                    currentGear = selectedGear;
                    updateGearStickPos(selectedGear);
                }
                updateDashboardGears();
            } else {
                // Grinding gears visual feedback!
                playMechanicalSound('grind');
                keySlot.style.boxShadow = "inset 0 0 20px red";
                setTimeout(() => { keySlot.style.boxShadow = ""; }, 200);
            }
        });
    });

    function updateGearStickPos(gear) {
        playMechanicalSound('gear_shift');
        // Remove all g-* classes and inline styles from dragging
        gearStick.className = 'gear-stick';
        gearStick.style.top = '';
        gearStick.style.left = '';
        gearSlots.forEach(s => s.classList.remove('active'));

        if (gear !== 'N') {
            gearStick.classList.add('g-' + gear);
            document.querySelector(`.gear-slot[data-gear="${gear}"]`).classList.add('active');
        }
    }

    function updateDashboardGears() {
        currentGearEl.innerText = currentGear;
    }

    // --- PEDALS ---
    function setupPedal(el, onDown, onUp) {
        // Mouse events
        el.addEventListener('mousedown', () => {
            initAudio(); // Required to init on first interaction if they click pedal first
            if (!el.classList.contains('pressed')) playMechanicalSound('pedal_down');
            el.classList.add('pressed');
            onDown();
        });

        // Touch events for mobile/tablets
        el.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent scrolling
            initAudio();
            if (!el.classList.contains('pressed')) playMechanicalSound('pedal_down');
            el.classList.add('pressed');
            onDown();
        }, { passive: false });

        // We use global mouseup/touchend to catch release outside the element
        const upHandler = (e) => {
            if (el.classList.contains('pressed')) {
                playMechanicalSound('pedal_up');
                el.classList.remove('pressed');
                onUp();
            }
        };

        document.addEventListener('mouseup', upHandler);
        document.addEventListener('touchend', upHandler);
    }

    setupPedal(clutchEl, () => clutchPressed = true, () => clutchPressed = false);
    setupPedal(brakeEl, () => brakePressed = true, () => brakePressed = false);
    setupPedal(gasEl, () => gasPressed = true, () => gasPressed = false);

    // --- KEYBOARD CONTROLS ---
    let keyLIsDown = false;
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return; // Prevent continuous firing if key held down
        const key = e.key.toLowerCase();

        // Pedals & Ignition
        if (key === 'l') {
            if (!keyLIsDown) {
                keyLIsDown = true;
                pressIgnition();
            }
        } else if (key === 'z') {
            if (!clutchPressed) { playMechanicalSound('pedal_down'); initAudio(); }
            clutchEl.classList.add('pressed');
            clutchPressed = true;
        } else if (key === 'x') {
            if (!brakePressed) { playMechanicalSound('pedal_down'); initAudio(); }
            brakeEl.classList.add('pressed');
            brakePressed = true;
        } else if (key === 'c') {
            if (!gasPressed) { playMechanicalSound('pedal_down'); initAudio(); }
            gasEl.classList.add('pressed');
            gasPressed = true;
        }

        // Gears (1-5, R)
        const gearKeys = ['1', '2', '3', '4', '5', 'r'];
        if (gearKeys.includes(key)) {
            const gearToSelect = key.toUpperCase();
            const slot = document.querySelector(`.gear-slot[data-gear="${gearToSelect}"]`);
            if (slot) {
                // Programmatically trigger the click logic
                slot.click();
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'l') {
            keyLIsDown = false;
            releaseIgnition();
        } else if (key === 'z') {
            if (clutchPressed) playMechanicalSound('pedal_up');
            clutchEl.classList.remove('pressed');
            clutchPressed = false;
        } else if (key === 'x') {
            if (brakePressed) playMechanicalSound('pedal_up');
            brakeEl.classList.remove('pressed');
            brakePressed = false;
        } else if (key === 'c') {
            if (gasPressed) playMechanicalSound('pedal_up');
            gasEl.classList.remove('pressed');
            gasPressed = false;
        }
    });

    // --- GEAR STICK DRAGGING ---
    let isDraggingGear = false;
    const gearboxEl = document.querySelector('.gearbox');

    // Track the locked lane when moving out of neutral
    let lockedLane = null;

    gearStick.addEventListener('mousedown', (e) => {
        isDraggingGear = true;
        gearStick.classList.add('dragging');
        // Initialize locked lane based on current position
        const rect = gearboxEl.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 100;
        lockedLane = getClosestLane(px);
        updateDragPosition(e.clientX, e.clientY);
    });

    gearStick.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDraggingGear = true;
        gearStick.classList.add('dragging');
        const rect = gearboxEl.getBoundingClientRect();
        const px = ((e.touches[0].clientX - rect.left) / rect.width) * 100;
        lockedLane = getClosestLane(px);
        updateDragPosition(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingGear) return;
        updateDragPosition(e.clientX, e.clientY);
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDraggingGear) return;
        updateDragPosition(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    // Helper to snap to vertical lanes
    function getClosestLane(px) {
        if (px < 33) return 16.6;
        if (px < 66) return 50.0;
        return 83.3;
    }

    function updateDragPosition(x, y) {
        const rect = gearboxEl.getBoundingClientRect();

        // Calculate raw percentages within the gearbox
        let px = ((x - rect.left) / rect.width) * 100;
        let py = ((y - rect.top) / rect.height) * 100;

        // --- H-PATTERN CONSTRICTION LOGIC ---
        // Define the horizontal neutral line at Y=50%
        // Define the three vertical gear lanes at X ≈ 16.6%, 50%, 83.3%
        const laneX1 = 16.6;
        const laneX3 = 83.3;
        const neutralY = 50.0;
        const flex = 10; // Allow 10% wiggle room around paths

        // If we are close to the neutral line (Y ≈ 50%), we can move horizontally
        if (Math.abs(py - neutralY) < flex) {
            py = neutralY; // Snap strictly to horizontal center line
            // X can flow freely between lane 1 and lane 3
            px = Math.max(laneX1, Math.min(laneX3, px));

            // Re-evaluate locked lane as we slide in neutral
            lockedLane = getClosestLane(px);
        } else {
            // If we are moving vertically to a gear, we MUST snap to the locked vertical lane
            px = lockedLane;
            // Limit vertical movement between top (20%) and bottom (80%) gears
            py = Math.max(20, Math.min(80, py));
        }

        // Use inline styles to move it securely
        gearStick.style.left = px + '%';
        gearStick.style.top = py + '%';
        gearStick.className = 'gear-stick dragging'; // Remove g-* classes
    }

    const gearDragEnd = (e) => {
        if (!isDraggingGear) return;
        isDraggingGear = false;
        gearStick.classList.remove('dragging');

        // Allow click to process before calculating nearest, actually let's calculate exact distance
        const stickRect = gearStick.getBoundingClientRect();
        const sx = stickRect.left + stickRect.width / 2;
        const sy = stickRect.top + stickRect.height / 2;

        let closestSlot = null;
        let minDistance = 50; // Max snap distance in pixels

        gearSlots.forEach(slot => {
            const r = slot.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dist = Math.hypot(cx - sx, cy - sy);

            if (dist < minDistance) {
                minDistance = dist;
                closestSlot = slot;
            }
        });

        if (closestSlot) {
            closestSlot.click();
        } else {
            // Snap back to Neutral
            if (currentGear !== 'N') {
                document.querySelector('.gear-slot[data-gear="N"]') || (() => {
                    // Create an imitation Neutral click since there's no physical N slot
                    if (clutchPressed || !engineOn) {
                        currentGear = 'N';
                        updateGearStickPos('N');
                        updateDashboardGears();
                    } else {
                        // Grinding gears
                        playMechanicalSound('grind');
                        keySlot.style.boxShadow = "inset 0 0 20px red";
                        setTimeout(() => { keySlot.style.boxShadow = ""; }, 200);
                        updateGearStickPos(currentGear); // Snap back to current gear
                    }
                })();
            } else {
                updateGearStickPos('N');
            }
        }
    };

    document.addEventListener('mouseup', gearDragEnd);
    document.addEventListener('touchend', gearDragEnd);

    // --- STEERING WHEEL ---
    let isDraggingWheel = false;
    let initialAngle = 0;
    let currentAngle = 0;

    steeringWheel.addEventListener('mousedown', (e) => {
        isDraggingWheel = true;
        steeringWheel.style.transition = 'none';
        initialAngle = getAngle(e.clientX, e.clientY) - currentAngle;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingWheel) return;
        const newAngle = getAngle(e.clientX, e.clientY);
        currentAngle = newAngle - initialAngle;

        // Limit rotation between -540 and 540 degrees (1.5 turns each way)
        if (currentAngle > 540) currentAngle = 540;
        if (currentAngle < -540) currentAngle = -540;

        steeringWheel.style.transform = `rotate(${currentAngle}deg)`;
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingWheel) {
            isDraggingWheel = false;
            steeringWheel.style.transition = 'transform 0.5s ease-out';
            // Auto-center wheel slowly when let go
            currentAngle = 0;
            steeringWheel.style.transform = `rotate(${currentAngle}deg)`;
        }
    });

    function getAngle(x, y) {
        const rect = steeringWheel.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // atan2 gives angle from X axis, we adjust relative to vertical 
        const rad = Math.atan2(y - centerY, x - centerX);
        return rad * (180 / Math.PI) + 90; // +90 so 0 deg is up
    }


    // --- SIMULATION LOOP ---
    let lastTime = performance.now();

    function updatePhysics(time) {
        const deltaTime = Math.min((time - lastTime) / 1000, 0.1); // Max 100ms delta to prevent huge jumps
        lastTime = time;

        const maxRpm = 8000;
        const idleRpm = 800;

        // --- IGNITION CRANKING LOGIC ---
        if (ignitionHeld && !engineOn) {
            ignitionProgress += deltaTime;
            // Starter motor flutter
            rpm = 300 + (Math.random() * 100 - 50);

            if (ignitionProgress >= currentStartDifficulty) {
                // Engine starts!
                engineOn = true;
                ignitionHeld = false;
                clearInterval(crankInterval);
                carKey.classList.remove('cranking');
                carKey.classList.add('on');
                engineStatusEl.innerText = 'ENGINE: ON';
                engineStatusEl.classList.add('on');
                engineStatusEl.style.color = '';
                rpm = 1200; // Small rev upon starting
                currentStartDifficulty = Math.random() * 2 + 1; // Reset for next time

                if (engineGain && audioCtx) {
                    engineGain.gain.setValueAtTime(0, audioCtx.currentTime);
                    engineGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
                }
            }
        }

        if (engineOn) {
            let isReverse = currentGear === 'R';
            let gearRatio = 0;
            if (currentGear !== 'N') {
                switch (currentGear) {
                    case '1': gearRatio = 120; break;
                    case '2': gearRatio = 75; break;
                    case '3': gearRatio = 50; break;
                    case '4': gearRatio = 35; break;
                    case '5': gearRatio = 25; break;
                    case 'R': gearRatio = 120; break;
                }
            }

            // 1. Handle user inputs (Gas / No Gas)
            if (gasPressed && (clutchPressed || currentGear === 'N')) {
                // Free revving
                rpm += 5000 * deltaTime;
            } else if (gasPressed && currentGear !== 'N' && !clutchPressed) {
                // Accelerating in gear (engine pushes car)
                rpm += 3500 * deltaTime; // Engine wants to rev
                let accel = 0;
                switch (currentGear) {
                    case '1': accel = 35; break;
                    case '2': accel = 22; break;
                    case '3': accel = 15; break;
                    case '4': accel = 10; break;
                    case '5': accel = 6; break;
                    case 'R': accel = -25; break;
                }

                // Speed Limiter for each gear
                let maxSpeedForGear = maxRpm / gearRatio;
                if (Math.abs(speed) >= maxSpeedForGear) {
                    accel = 0; // Cut fuel/acceleration at the rev limiter
                    rpm = maxRpm - (Math.random() * 300); // Rev limiter bounce effect
                }

                speed += accel * deltaTime;
            } else {
                // No Gas
                rpm -= 2500 * deltaTime; // Engine RPM naturally drops

                if (!clutchPressed && currentGear !== 'N') {
                    let wheelsRpm = Math.abs(speed) * gearRatio;
                    // Creep logic: If speed is so low that wheels RPM < idle RPM
                    if (wheelsRpm < idleRpm) {
                        // The engine idle controller tries to prevent stall by adding torque
                        if (currentGear === '1') speed += 10 * deltaTime;
                        else if (currentGear === '2') speed += 4 * deltaTime;
                        else if (currentGear === 'R') speed -= 10 * deltaTime;
                    } else {
                        // Engine braking (frenar con marchas)
                        // Scales with RPM. Higher RPM = Much stronger engine braking
                        let brakeForce = (wheelsRpm / 1000) * 8;

                        // Over-revving penalty (downshifted at too high speed)
                        if (wheelsRpm > maxRpm) {
                            brakeForce += 40; // Massive braking force to save engine
                            if (Math.random() < 0.2) playMechanicalSound('grind'); // Audible stress
                        }

                        speed -= Math.sign(speed) * brakeForce * deltaTime;
                    }
                }
            }

            // 2. Sync Engine RPM with Wheels when clutch is engaged
            if (!clutchPressed && currentGear !== 'N') {
                let wheelsTargetRpm = Math.abs(speed) * gearRatio;

                // If clutch is dropped at high RPM with gas, slip the clutch to accelerate
                if (gasPressed && rpm > wheelsTargetRpm + 100) {
                    // Transfer momentum to car (launching)
                    let torque = (rpm - wheelsTargetRpm) * (gearRatio / 100);
                    speed += (isReverse ? -1 : 1) * torque * 0.008 * deltaTime;

                    // Prevent RPM from tanking instantly to simulate clutch slip
                    wheelsTargetRpm = Math.max(wheelsTargetRpm, rpm - 4000 * deltaTime);
                } else if (wheelsTargetRpm < idleRpm && !gasPressed) {
                    // Simulated clutch biting resistance (no gas) -> stalls fast
                    wheelsTargetRpm = Math.max(wheelsTargetRpm, rpm - 1500 * deltaTime);
                }

                // Lock RPM to wheels (except if bouncing off rev limiter)
                let maxSpeedForGear = maxRpm / gearRatio;
                if (!(gasPressed && Math.abs(speed) >= maxSpeedForGear)) {
                    rpm += (wheelsTargetRpm - rpm) * 12 * deltaTime;
                }

                // Stop going the wrong way if in gear
                if (isReverse && speed > 0) speed -= 50 * deltaTime;
                if (!isReverse && speed < 0 && currentGear !== 'N') speed += 50 * deltaTime;
            }

            // 3. Clamp and Idle logic
            rpm = Math.min(Math.max(0, rpm), maxRpm);
            if (currentGear === 'N' || clutchPressed) {
                rpm = Math.max(idleRpm, rpm); // Don't drop below idle if disconnected
            }

            // 4. Global stall check
            if (rpm < 300 && engineOn && currentGear !== 'N' && !clutchPressed) {
                engineOn = false;
                playMechanicalSound('grind'); // Stall sound
                if (engineGain) engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
                carKey.classList.remove('on');
                engineStatusEl.innerText = 'ENGINE: STALLED';
                engineStatusEl.classList.remove('on');
                engineStatusEl.style.color = '#ff3333';
                setTimeout(() => engineStatusEl.style.color = '', 2000);
            }
        } else {
            // Engine off
            rpm -= 2500 * deltaTime;
            rpm = Math.max(0, rpm);
        }

        // Apply braking and rolling resistance
        if (brakePressed) {
            speed -= Math.sign(speed) * 60 * deltaTime; // Strong brake
            if (Math.abs(speed) < 2) speed = 0; // Stop completely
        } else {
            // Natural drag / friction
            speed -= Math.sign(speed) * 1.5 * deltaTime;
            if (Math.abs(speed) < 0.5) speed = 0;
        }

        // Speed limit
        if (speed > 250) speed = 250;
        if (speed < -50) speed = -50;

        // --- UPDATE AUDIO ---
        if (engineOn && engineOsc && engineGain && audioCtx) {
            // Map RPM (800 - 8000) to pitch (frequency)
            // Idle freq = 40. Smooth ramp.
            const targetPitch = 40 + (rpm / maxRpm) * 160;
            engineOsc.frequency.setTargetAtTime(targetPitch, audioCtx.currentTime, 0.1);
            if (engineOsc.sub) {
                engineOsc.sub.frequency.setTargetAtTime(targetPitch / 2, audioCtx.currentTime, 0.1);
            }

            // Adjust volume based on throttle
            const targetVol = gasPressed ? 0.8 : 0.4;
            engineGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.2);
        }

        // --- UPDATE UI ---
        rpmValueEl.innerText = String(Math.round(rpm)).padStart(4, '0');
        speedValueEl.innerText = String(Math.abs(Math.round(speed))).padStart(3, '0');

        // Optional: Simple visual shake on gauges based on RPM
        const shake = (rpm / maxRpm) * 2;
        if (shake > 0.5 && engineOn) {
            document.querySelector('.dashboard').style.transform = `translate(${Math.random() * shake - shake / 2}px, ${Math.random() * shake - shake / 2}px)`;
        } else {
            document.querySelector('.dashboard').style.transform = `translate(0px, 0px)`;
        }

        requestAnimationFrame(updatePhysics);
    }

    requestAnimationFrame(updatePhysics);
});
