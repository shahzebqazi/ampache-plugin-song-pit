/**
 * Lightweight WebGL fragment pass: barrel distortion, scanlines, vignette,
 * subtle RGB split. Falls back via return value so the caller can use CSS.
 */

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_res;
varying vec2 v_uv;

vec2 crt_curve(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  float k = 0.055;
  c *= 1.0 + k * dot(c, c);
  return c * 0.5 + 0.5;
}

void main() {
  vec2 uv_img = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 uv = crt_curve(uv_img);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.04, 0.04, 0.05, 1.0);
    return;
  }

  float ab = 0.0022;
  float r = texture2D(u_tex, uv + vec2(ab, 0.0)).r;
  float g = texture2D(u_tex, uv).g;
  float b = texture2D(u_tex, uv - vec2(ab, 0.0)).b;
  vec3 col = vec3(r, g, b);

  float lines = sin(uv.y * u_res.y * 3.14159265 * 0.42);
  float scan = 0.86 + 0.14 * lines;
  col *= scan;

  float mask = mod(floor(uv.y * u_res.y * 0.5), 2.0);
  col *= 0.9 + 0.1 * mask;

  vec2 d = v_uv - 0.5;
  float vig = 1.0 - dot(d, d) * 0.65;
  col *= vig;

  col *= vec3(0.97, 1.03, 0.99);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) {
    return null;
  }
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vs: WebGLShader,
  fs: WebGLShader
): WebGLProgram | null {
  const p = gl.createProgram();
  if (!p) {
    return null;
  }
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function setCanvasSize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function disposeGl(
  gl: WebGLRenderingContext,
  tex: WebGLTexture | null,
  buf: WebGLBuffer | null,
  prog: WebGLProgram | null
) {
  if (tex) {
    gl.deleteTexture(tex);
  }
  if (buf) {
    gl.deleteBuffer(buf);
  }
  if (prog) {
    gl.deleteProgram(prog);
  }
}

/**
 * @returns cleanup, or `null` if WebGL / shaders / image failed (use CSS fallback).
 */
export function mountCrtBackground(
  canvas: HTMLCanvasElement,
  imageUrl: string
): Promise<(() => void) | null> {
  return new Promise((resolve) => {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      resolve(null);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      resolve(null);
      return;
    }
    const prog = linkProgram(gl, vs, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!prog) {
      resolve(null);
      return;
    }

    const buf = gl.createBuffer();
    if (!buf) {
      gl.deleteProgram(prog);
      resolve(null);
      return;
    }

    const quad = new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const aUv = gl.getAttribLocation(prog, 'a_uv');
    const uTex = gl.getUniformLocation(prog, 'u_tex');
    const uRes = gl.getUniformLocation(prog, 'u_res');

    const tex = gl.createTexture();
    if (!tex) {
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      resolve(null);
      return;
    }

    let alive = true;
    const img = new Image();
    try {
      const abs = new URL(imageUrl, window.location.href);
      if (abs.origin !== window.location.origin) {
        img.crossOrigin = 'anonymous';
      }
    } catch {
      /* relative URL — same document */
    }

    const draw = () => {
      if (!alive || !img.complete || !img.naturalWidth) {
        return;
      }
      const { w, h } = setCanvasSize(canvas);
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uRes, w, h);

      gl.clearColor(0.02, 0.02, 0.03, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const onResize = () => {
      draw();
    };

    img.onload = () => {
      draw();
      window.addEventListener('resize', onResize);
      resolve(() => {
        alive = false;
        window.removeEventListener('resize', onResize);
        disposeGl(gl, tex, buf, prog);
      });
    };
    img.onerror = () => {
      disposeGl(gl, tex, buf, prog);
      resolve(null);
    };
    img.src = imageUrl;
  });
}
