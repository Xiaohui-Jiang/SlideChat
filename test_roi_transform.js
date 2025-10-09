// Test script to validate ROI coordinate transformation logic

// Test the coordinate transformation functions
function screenToImageCoords(screenRect, offset, scale) {
  return {
    x: (screenRect.x - offset.x) / scale,
    y: (screenRect.y - offset.y) / scale,
    w: screenRect.w / scale,
    h: screenRect.h / scale,
  };
}

function imageToScreenCoords(imageRect, offset, scale) {
  return {
    x: offset.x + imageRect.x * scale,
    y: offset.y + imageRect.y * scale,
    w: imageRect.w * scale,
    h: imageRect.h * scale,
  };
}

// Test cases
console.log('=== ROI Coordinate Transform Test ===\n');

// Test case 1: No zoom, no pan (identity transform)
console.log('Test 1: No zoom, no pan');
const test1_offset = { x: 0, y: 0 };
const test1_scale = 1;
const test1_screen = { x: 100, y: 50, w: 200, h: 150 };

const test1_image = screenToImageCoords(test1_screen, test1_offset, test1_scale);
const test1_back = imageToScreenCoords(test1_image, test1_offset, test1_scale);

console.log('Screen rect:', test1_screen);
console.log('Image rect:', test1_image);
console.log('Back to screen:', test1_back);
console.log('Round-trip correct:', JSON.stringify(test1_screen) === JSON.stringify(test1_back));
console.log();

// Test case 2: 2x zoom, no pan
console.log('Test 2: 2x zoom, no pan');
const test2_offset = { x: 0, y: 0 };
const test2_scale = 2;
const test2_screen = { x: 200, y: 100, w: 400, h: 300 };

const test2_image = screenToImageCoords(test2_screen, test2_offset, test2_scale);
const test2_back = imageToScreenCoords(test2_image, test2_offset, test2_scale);

console.log('Screen rect:', test2_screen);
console.log('Image rect:', test2_image);
console.log('Back to screen:', test2_back);
console.log('Round-trip correct:', JSON.stringify(test2_screen) === JSON.stringify(test2_back));
console.log();

// Test case 3: 2x zoom with pan
console.log('Test 3: 2x zoom with pan');
const test3_offset = { x: -50, y: -25 };
const test3_scale = 2;
const test3_screen = { x: 200, y: 100, w: 400, h: 300 };

const test3_image = screenToImageCoords(test3_screen, test3_offset, test3_scale);
const test3_back = imageToScreenCoords(test3_image, test3_offset, test3_scale);

console.log('Screen rect:', test3_screen);
console.log('Image rect:', test3_image);
console.log('Back to screen:', test3_back);
console.log('Round-trip correct:', JSON.stringify(test3_screen) === JSON.stringify(test3_back));
console.log();

// Test case 4: 0.5x zoom with pan
console.log('Test 4: 0.5x zoom with pan');
const test4_offset = { x: 100, y: 75 };
const test4_scale = 0.5;
const test4_screen = { x: 200, y: 150, w: 100, h: 75 };

const test4_image = screenToImageCoords(test4_screen, test4_offset, test4_scale);
const test4_back = imageToScreenCoords(test4_image, test4_offset, test4_scale);

console.log('Screen rect:', test4_screen);
console.log('Image rect:', test4_image);
console.log('Back to screen:', test4_back);
console.log('Round-trip correct:', JSON.stringify(test4_screen) === JSON.stringify(test4_back));
console.log();

console.log('=== Example Scenarios ===\n');

// Scenario: User draws ROI on zoomed image
console.log('Scenario: User draws ROI at screen coordinates (150, 100, 200, 150)');
console.log('with zoom 2x and pan offset (-100, -50)');

const scenario_offset = { x: -100, y: -50 };
const scenario_scale = 2;
const scenario_screen = { x: 150, y: 100, w: 200, h: 150 };

const scenario_image = screenToImageCoords(scenario_screen, scenario_offset, scenario_scale);
const scenario_display = imageToScreenCoords(scenario_image, scenario_offset, scenario_scale);

console.log('User draws at screen coords:', scenario_screen);
console.log('Saved as image coords:', scenario_image);
console.log('When displayed, shown at screen coords:', scenario_display);
console.log('Display matches original drawing:', JSON.stringify(scenario_screen) === JSON.stringify(scenario_display));