/*
 * DSB Aegean water. Selected spectrum, FFT and Fresnel routines adapted from
 * Clearwater, https://github.com/Aureliengmz/clearwater
 * revision 4bc826134321043a25df3c2b6fed16fb7b9241e8.
 * Copyright (c) 2026 Lumaris. MIT license:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(() => {
  "use strict";
  const BL=window.BL=window.BL||{}, N=64, L=32, LEVEL=-.3, SIZE=650, B=256;
  // Strided, unnormalised inverse FFT. Caller owns every buffer.
  const fft=(re,im,start,stride)=>{
    for(let i=1,j=0;i<N;i++){
      let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j){const a=start+i*stride,b=start+j*stride;let t=re[a];re[a]=re[b];re[b]=t;t=im[a];im[a]=im[b];im[b]=t;}
    }
    for(let len=2;len<=N;len<<=1){
      const wr=Math.cos(2*Math.PI/len),wi=Math.sin(2*Math.PI/len),h=len>>1;
      for(let i=0;i<N;i+=len){let cr=1,ci=0;
        for(let k=0;k<h;k++){
          const a=start+(i+k)*stride,b=a+h*stride,xr=re[b]*cr-im[b]*ci,xi=re[b]*ci+im[b]*cr;
          re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;
          const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;
        }
      }
    }
  };
  const bounded=(v,lo,hi,fallback)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
  const create=land=>{
    const re=new Float32Array(N*N),im=new Float32Array(N*N),h0r=new Float32Array(N*N),h0i=new Float32Array(N*N),omega=new Float32Array(N*N);
    const pixels=new Uint8Array(N*N*4),depths=new Uint8Array(B*B*4);
    let seed=7,s2=0;
    const rand=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
    const gauss=()=>Math.sqrt(-2*Math.log(Math.max(1e-9,rand())))*Math.cos(2*Math.PI*rand());
    for(let z=0;z<N;z++)for(let x=0;x<N;x++){
      const i=z*N+x,kx=2*Math.PI*(x<N/2?x:x-N)/L,kz=2*Math.PI*(z<N/2?z:z-N)/L,k=Math.hypot(kx,kz);
      let p=0;
      if(k>0){
        const kp=2*Math.PI/4,c=(kx*.8+kz*.6)/k;
        p=(Math.exp(-.5*(Math.log(k/kp)/.36)**2)+.35*Math.exp(-.5*(Math.log(k/(2*Math.PI/10))/.3)**2))*(.3+.7*c*c)*(c<0?.35:1)/(k*k*k*k);
      }
      h0r[i]=gauss()*Math.sqrt(p/2);h0i[i]=gauss()*Math.sqrt(p/2);
      s2+=2*k*k*(h0r[i]**2+h0i[i]**2);
      omega[i]=Math.floor(Math.sqrt(9.81*k*Math.tanh(k*5))/(2*Math.PI/120))*(2*Math.PI/120);
    }
    const scale=.075/Math.sqrt(s2);
    for(let i=0;i<N*N;i++){h0r[i]*=scale;h0i[i]*=scale;}
    // Only optical depth extends offshore. No terrain, collision or coast edits.
    const depthAt=(x,z)=>{
      let distance=Infinity;
      for(let i=0,j=land.coast.length-1;i<land.coast.length;j=i++){
        const a=land.coast[j],b=land.coast[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
        distance=Math.min(distance,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
      }
      const depth=Math.max(0,LEVEL-land.heightAt(x,z));
      return Math.min(30,depth+Math.max(0,distance-6)*.18*(depth>4?1:0));
    };
    for(let z=0;z<B;z++)for(let x=0;x<B;x++){
      const i=(z*B+x)*4,d=depthAt(((x+.5)/B-.5)*SIZE,((z+.5)/B-.5)*SIZE);
      depths[i]=Math.round(d/30*255);depths[i+3]=255;
    }
    // A static mean surface retains the exact approved waterline. FFT height
    // drives optical normals/caustics, without flooding paths or moving piers.
    const geometry={verts:[],faces:[],lines:[],castShadow:false}, G=64;
    for(let z=0;z<=G;z++)for(let x=0;x<=G;x++)geometry.verts.push((x/G-.5)*SIZE,LEVEL,(z/G-.5)*SIZE);
    for(let z=0;z<G;z++)for(let x=0;x<G;x++){
      const a=z*(G+1)+x,b=a+1,c=a+G+1,d=c+1,depth=depthAt(((x+.5)/G-.5)*SIZE,((z+.5)/G-.5)*SIZE),k=Math.min(1,depth/12);
      const color=[Math.round(45-31*k),Math.round(165-91*k),Math.round(175-58*k)];
      geometry.faces.push({i:[a,c,b],color,water:"aegean"},{i:[b,c,d],color,water:"aegean"});
    }
    const node=BL.scene.createNode({geometry});
    const update=time=>{
      const t=time%120;
      for(let z=0;z<N;z++)for(let x=0;x<N;x++){
        const i=z*N+x,j=((N-z)%N)*N+(N-x)%N,c=Math.cos(omega[i]*t),s=Math.sin(omega[i]*t);
        re[i]=(h0r[i]+h0r[j])*c-(h0i[i]+h0i[j])*s;
        im[i]=(h0r[i]-h0r[j])*s+(h0i[i]-h0i[j])*c;
      }
      for(let i=0;i<N;i++)fft(re,im,i*N,1);
      for(let i=0;i<N;i++)fft(re,im,i,N);
      for(let z=0;z<N;z++)for(let x=0;x<N;x++){
        const i=z*N+x,l=z*N+(x+N-1)%N,r=z*N+(x+1)%N,u=((z+N-1)%N)*N+x,d=((z+1)%N)*N+x;
        pixels[i*4]=Math.round(Math.max(0,Math.min(1,.5+(re[r]-re[l])/(2*L/N)))*255);
        pixels[i*4+1]=Math.round(Math.max(0,Math.min(1,.5+(re[d]-re[u])/(2*L/N)))*255);
        pixels[i*4+2]=Math.round(Math.max(0,Math.min(1,.5+(re[l]+re[r]+re[u]+re[d]-4*re[i])))*255);
        pixels[i*4+3]=Math.round(Math.max(0,Math.min(1,.5+re[i]))*255);
      }
      state.version++;
    };
    const environment=new Float32Array([1,0,1,1]);
    const setEnvironment=value=>{
      environment[0]=bounded(value.waveEnergy,1,3,1);
      environment[1]=bounded(value.roughness,0,1,0);
      environment[2]=bounded(value.glint,0,1,1);
      environment[3]=bounded(value.foam,1,3,1);
    };
    const state={environment,setEnvironment,node,geometry,pixels,depths,update,version:0,size:N,depthSize:B,depthAt,heights:re};
    update(0);return state;
  };
  const gpu=(gl,state)=>{
    const texture=(unit,n,data,repeat)=>{
      gl.activeTexture(gl.TEXTURE0+unit);const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,n,n,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
      return tex;
    };
    const surface=texture(7,N,state.pixels,true),depth=texture(8,B,state.depths,false);let version=state.version;
    return {state,bind:program=>{
      gl.useProgram(program.prog);
      gl.uniform4fv(program.u.uDSBEnvironment,state.environment);
      gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,surface);
      if(version!==state.version){gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,N,N,gl.RGBA,gl.UNSIGNED_BYTE,state.pixels);version=state.version;}
      gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_2D,depth);gl.activeTexture(gl.TEXTURE0);
    },dispose:()=>{gl.deleteTexture(surface);gl.deleteTexture(depth);}};
  };
  const shader=`
uniform sampler2D uDSBSurface;
uniform sampler2D uDSBDepth;
uniform vec4 uDSBEnvironment; // wave energy, roughness, sun glint, shoreline foam
float dsbFresnel(float ci) {
  ci=clamp(ci,0.001,1.0);
  float n=1.333,ct=sqrt(1.0-(1.0-ci*ci)/(n*n));
  float rs=(ci-n*ct)/(ci+n*ct),rp=(n*ci-ct)/(n*ci+ct);
  return .5*(rs*rs+rp*rp);
}
vec3 dsbWaterShade(out vec3 bright) {
  vec2 p=vWorld.xz;
  vec4 a=texture(uDSBSurface,p/32.0),b=texture(uDSBSurface,mat2(.8,-.6,.6,.8)*p/13.12+.37);
  vec2 slope=(a.rg-.5)+.22*mat2(.8,.6,-.6,.8)*(b.rg-.5);
  float depth=texture(uDSBDepth,p/650.0+.5).r*30.0;
  slope*=uDSBEnvironment.x*smoothstep(0.0,1.0,depth);
  vec3 n=normalize(vec3(-slope.x,1.0,-slope.y)),v=normalize(uEye-vWorld);
  vec3 r=reflect(-v,n),tr=refract(-v,n,1.0/1.333);
  vec2 floorP=p+tr.xz*depth/max(.25,-tr.y);
  float path=depth/max(.25,-tr.y);
  vec3 transmission=exp(-vec3(.42,.115,.065)*path);
  float daylight=clamp(uDirectStrength,0.0,1.0);
  float lightLevel=clamp(dot(uSky,vec3(.25,.5,.25))+.7*daylight,.025,1.0);
  float sand=.9+.1*sin(dot(floorP,vec2(1.7,.8))+vnoise(floorP*.7)*3.0);
  float curvature=texture(uDSBSurface,floorP/32.0).b-.5;
  float caustic=clamp(1.0-curvature*7.0,.55,1.7);
  vec3 bottom=vec3(.68,.63,.43)*sand*(1.0+(caustic-1.0)*daylight*exp(-depth*.22));
  vec3 body=mix(vec3(.012,.22,.32),bottom,transmission)*lightLevel;
  vec3 reflection=uSky*(.8+.45*max(r.y,0.0));
  float fres=dsbFresnel(max(dot(v,n),0.0));
  float glint=pow(max(dot(r,uLightDir),0.0),mix(180.0,65.0,uDSBEnvironment.y))*daylight*uDSBEnvironment.z;
  float foam=(1.0-smoothstep(.1,.85,depth))*smoothstep(.51,.63,a.a)*.22*uDSBEnvironment.w;
  vec3 col=mix(body,reflection,fres)+uSun*glint*1.5+vec3(foam*lightLevel);
  bright=uSun*glint*.65;
  return col;
}
`;
  BL.dsbWater={create,gpu,shader};
})();
